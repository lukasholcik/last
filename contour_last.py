"""Contour-distance adapter over the unchanged top and bottom constructors.

Regional arc preservation and station mapping are prototype design assumptions,
not vendor algorithms, anatomical correspondence, or a heel-posture model.
"""

import copy
import math

from bottom_profile import (arc_length_bounds, bottom_curve_points,
                            build_bottom_model, validate_bottom_model)
from last_shape import bezier, build_model, validate_model

STATIONS = tuple(f"{side}_{region}" for side in ("medial","lateral")
                 for region in ("heel","waist","ball","toe"))
BOTTOM_FIELDS = {"heel_height","toe_spring","seat_arc_length","seat_inclination_deg","contact_s","blend_arc_length"}
ARC_BUDGET = 1e-5
ARC_TOLERANCE = 0.01


def _number(name,value,minimum=0,maximum=10000):
    if (isinstance(value,bool) or not isinstance(value,(int,float))
            or not minimum<=value<=maximum or not math.isfinite(value)):
        raise ValueError(f"{name} must be finite and between {minimum} and {maximum}")
    return value


def _gap(value):
    return value>=0.01 or math.isclose(value,0.01,rel_tol=0,abs_tol=1e-11)


def _json_values(value,depth=0):
    if depth>64:
        raise ValueError("JSON nesting is too deep")
    if isinstance(value,float) and not math.isfinite(value):
        raise ValueError("JSON numbers must be finite")
    if isinstance(value,dict):
        for item in value.values():
            _json_values(item,depth+1)
    elif isinstance(value,list):
        for item in value:
            _json_values(item,depth+1)


def read_inputs(inputs):
    _json_values(inputs)
    if isinstance(inputs,dict) and ("top" in inputs or "bottom" in inputs):
        raise ValueError("Obsolete projected {top,bottom} format; use one contour_last input document")
    if (not isinstance(inputs,dict) or set(inputs)!={"schema_version","kind","units","description","design"}
            or type(inputs.get("schema_version")) is not int or inputs["schema_version"]!=1
            or inputs.get("kind")!="contour_last" or inputs.get("units")!="mm"
            or not isinstance(inputs.get("description"),str)):
        raise ValueError("Expected contour_last schema_version 1, units mm, description and design")
    design=inputs["design"]
    if not isinstance(design,dict) or set(design)!={"last_length","top","bottom"}:
        raise ValueError("design requires exactly last_length, top and bottom")
    a=_number("last_length",design["last_length"],0.01)
    top,bottom=design["top"],design["bottom"]
    keys={n+suffix for n in STATIONS for suffix in ("_s","_width")}
    if not isinstance(top,dict) or set(top)!=keys:
        raise ValueError("top requires each named region's contour station _s and side _width")
    if not isinstance(bottom,dict) or set(bottom)!=BOTTOM_FIELDS:
        raise ValueError("bottom requires heel_height, toe_spring, seat_arc_length, seat_inclination_deg, contact_s, blend_arc_length")
    for name,value in top.items():
        _number(name,value,0.01)
    for side in ("medial","lateral"):
        stations=[0]+[top[f"{side}_{r}_s"] for r in ("heel","waist","ball","toe")]+[a]
        if not all(_gap(q-p) for p,q in zip(stations,stations[1:])):
            raise ValueError(f"{side} contour stations must satisfy 0 < heel_s < waist_s < ball_s < toe_s < last_length, with 0.01 mm gaps")
    for name,value in bottom.items():
        _number(name,value,maximum=90 if name=="seat_inclination_deg" else 10000)
    if bottom["seat_inclination_deg"]>=90:
        raise ValueError("seat_inclination_deg must be less than 90")
    s,c,j=(bottom[k] for k in ("seat_arc_length","contact_s","blend_arc_length"))
    if not all(_gap(v) for v in (s,c-s,j,a-c-j)):
        raise ValueError("Require 0 < seat_arc_length < contact_s < contact_s+blend_arc_length < last_length with 0.01 mm arc gaps")
    return a,top,bottom


def _arc(points,budget=ARC_BUDGET):
    lo,hi=arc_length_bounds(points,budget)
    return (lo+hi)/2


def _prefix(points,t):
    """General de Casteljau subdivision: retain the prefix of an actual cubic."""
    row=list(points)
    result=[row[0]]
    while len(row)>1:
        row=[tuple((1-t)*p[i]+t*q[i] for i in (0,1)) for p,q in zip(row,row[1:])]
        result.append(row[0])
    return result


def _forepart(total,contact,blend_arc,toe):
    ramp_arc=total-contact-blend_arc
    if toe>=blend_arc+ramp_arc:
        raise ValueError("toe_spring must be smaller than the available forepart arc last_length-contact_s")

    def projections(k):
        q=(1+k*k/6-k**4/40) if k<1e-5 else (math.hypot(1,k)+math.asinh(k)/k)/2
        return blend_arc/q,ramp_arc/math.hypot(1,k)

    if toe==0:
        return blend_arc,ramp_arc
    lo,hi=0.0,1.0
    for _ in range(64):
        b,r=projections(hi)
        if hi*(b/2+r)>=toe:
            break
        hi*=2
    else:
        raise ValueError("toe_spring forepart solve could not bracket a finite slope")
    for _ in range(80):
        mid=(lo+hi)/2
        b,r=projections(mid)
        if mid*(b/2+r)<toe:
            lo=mid
        else:
            hi=mid
    b,r=projections((lo+hi)/2)
    if not _gap(b) or not _gap(r):
        raise ValueError("forepart arc/height conflict: projected blend and ramp must each retain 0.01 mm")
    return b,r


def _bottom_inputs(bottom,seat,waist,blend,ramp):
    contact=seat+waist
    length=math.fsum((seat,waist,blend,ramp))
    top={"schema_version":1,"units":"mm","design":{"length":length}}
    values=dict(heel_height=bottom["heel_height"],toe_spring=bottom["toe_spring"],
                seat_projected_length=seat,seat_inclination_deg=bottom["seat_inclination_deg"],
                contact_forward=contact,forepart_blend_length=blend)
    return top,{"schema_version":2,"units":"mm","design":values}


def _solve_bottom(total,bottom):
    s,c,j=(bottom[k] for k in ("seat_arc_length","contact_s","blend_arc_length"))
    angle=math.radians(bottom["seat_inclination_deg"])
    seat=s*math.cos(angle)
    front=bottom["heel_height"]-s*math.sin(angle)
    if front<0:
        raise ValueError("seat front: B = heel_height - seat_arc_length*sin(seat_inclination_deg) must be >= 0")
    if not _gap(seat):
        raise ValueError("seat arc/angle conflict: seat projection must retain 0.01 mm")
    blend,ramp=_forepart(total,c,j,bottom["toe_spring"])
    target=c-s
    slope=math.tan(angle)
    # Match the unchanged constructor's floating-point expression at the cap.
    actual_front=bottom["heel_height"]-slope*seat
    upper=target
    if slope:
        upper=min(upper,math.nextafter(3*actual_front/slope,0))
        # The constructor recovers W as (seat+W)-seat. At the handle cap,
        # that rounded subtraction can still exceed the algebraic cap after
        # one nextafter. Retreat only this search endpoint, by station ulps,
        # and only within a small budget for the actual arithmetic chain.
        limit=upper
        retreat_budget=8*(math.ulp(seat)+math.ulp(upper)+math.ulp(seat+upper)
                         +math.ulp(actual_front)/slope)
        for _ in range(32):
            if actual_front-slope*((seat+upper)-seat)/3>=0:
                break
            step=max(math.ulp(upper),math.ulp(seat+upper))
            upper=math.nextafter(upper-step,0)
            if limit-upper>retreat_budget:
                raise ValueError("waist upper bracket cannot satisfy the nonnegative-handle rule within arithmetic roundoff")
        else:
            raise ValueError("waist upper bracket could not be made legal within 32 ulp retreats")
    lower=0.01
    if upper<lower:
        if _gap(upper):
            lower=upper  # Subtraction roundoff at the admitted 0.01 boundary.
        else:
            raise ValueError("waist arc/vertical-drop/seat-angle conflict: no nonnegative-handle projection >= 0.01 mm")

    def candidate(w):
        top,inputs=_bottom_inputs(bottom,seat,w,blend,ramp)
        model=build_bottom_model(top,inputs)
        return _arc(bottom_curve_points(model,"bottom_waist")),model,top,inputs

    low_arc=candidate(lower)[0]
    high_arc=candidate(upper)[0]
    if target<low_arc-ARC_BUDGET or target>high_arc+ARC_BUDGET:
        raise ValueError("waist arc/vertical-drop/seat-angle conflict: requested contact_s-seat_arc_length is unattainable without changing regions")
    for _ in range(64):
        mid=(lower+upper)/2
        actual,model,top,inputs=candidate(mid)
        if abs(actual-target)<=2e-5:
            return model,top,inputs
        if actual<target:
            lower=mid
        else:
            upper=mid
    raise ValueError("waist arc solve did not converge within 64 steps")


def _straight_arc(points,index):
    """Exact line inversion only for seat/ramp or an actually flat segment.

    The known straight regions still need actual-coordinate collinearity,
    allowing only the few ulps from storing their handles. Curved regions
    are never classified as lines merely for having very small curvature.
    """
    flat=all(p[1]==points[0][1] for p in points)
    if index not in (0,3) and not flat:
        return None
    dy=points[-1][0]-points[0][0]
    dz=points[-1][1]-points[0][1]
    if dy<=0:
        return None
    error=8*(max(math.ulp(p[1]) for p in points)
             +abs(dz/dy)*max(math.ulp(p[0]) for p in points))
    if any(abs(p[1]-(points[0][1]+dz*(p[0]-points[0][0])/dy))>error for p in points[1:-1]):
        return None
    return math.hypot(dy,dz)


def _map_station(curves,lengths,station):
    offset=0.0
    for i,(points,length) in enumerate(zip(curves,lengths)):
        if station<=offset+length or i==len(curves)-1:
            local=max(0,min(length,station-offset))
            if local==0:
                return points[0][0]
            if local==length:
                return points[-1][0]
            line_length=_straight_arc(points,i)
            if line_length is not None:
                return points[0][0]+local*(points[-1][0]-points[0][0])/line_length
            lo,hi=0.0,1.0
            for _ in range(48):
                t=(lo+hi)/2
                measured=_arc(_prefix(points,t),budget=1e-7)
                # Stop on the forward-coordinate bracket, not a coarse arc
                # residual that can invert the ordering of nearby stations.
                ylo=bezier(points,lo)[0]
                yhi=bezier(points,hi)[0]
                resolution=max(8*max(math.ulp(ylo),math.ulp(yhi)),
                               math.ldexp(points[-1][0]-points[0][0],-46))
                if yhi-ylo<=resolution:
                    return bezier(points,t)[0]
                if measured<local:
                    lo=t
                else:
                    hi=t
            raise ValueError("contour station inverse did not converge")
        offset+=length
    raise ValueError("contour station is outside the resulting guide")


def _arc_to_y(curves,lengths,y):
    """Independent forward-coordinate lookup for the validator's round trip."""
    offset=0.0
    for points,length in zip(curves,lengths):
        if y<=points[-1][0]:
            lo,hi=0.0,1.0
            for _ in range(48):
                t=(lo+hi)/2
                if bezier(points,t)[0]<y:
                    lo=t
                else:
                    hi=t
            return offset+_arc(_prefix(points,(lo+hi)/2))
        offset+=length
    return offset


def validate_contour_last(state,inputs):
    total,top,bottom=read_inputs(inputs)
    model=state["models"]["bottom"]
    curves=[bottom_curve_points(model,n) for n in model["profile"]]
    bounds=[arc_length_bounds(p,ARC_BUDGET) for p in curves]
    lengths=[(lo+hi)/2 for lo,hi in bounds]
    s,c,j=(bottom[k] for k in ("seat_arc_length","contact_s","blend_arc_length"))
    checks=[]

    def check(name,actual,expected,error=0):
        checks.append(dict(name=name,actual=actual,expected=expected,tolerance=ARC_TOLERANCE,
                           uncertainty_mm=error,units="mm",passed=math.isfinite(actual) and abs(actual-expected)+error<=ARC_TOLERANCE))

    check("last_length",sum(lengths),total,sum((hi-lo)/2 for lo,hi in bounds))
    check("seat_arc_length",lengths[0],s,(bounds[0][1]-bounds[0][0])/2)
    check("waist_arc_length",lengths[1],c-s,(bounds[1][1]-bounds[1][0])/2)
    check("contact_s",sum(lengths[:2]),c,sum((hi-lo)/2 for lo,hi in bounds[:2]))
    check("blend_arc_length",lengths[2],j,(bounds[2][1]-bounds[2][0])/2)
    check("blend_end_s",sum(lengths[:3]),c+j,sum((hi-lo)/2 for lo,hi in bounds[:3]))
    check("ramp_arc_length",lengths[3],total-c-j,(bounds[3][1]-bounds[3][0])/2)
    for name in STATIONS:
        y=state["models"]["top"]["points"][name]["y"]
        check(name+"_station_roundtrip",_arc_to_y(curves,lengths,y),top[name+"_s"],len(curves)*ARC_BUDGET)
    return dict(passed=all(c["passed"] for c in checks),checks=checks,units="mm",
                last_length_bounds=dict(lower=sum(v[0] for v in bounds),upper=sum(v[1] for v in bounds)),
                limits=["Contour stations and regional arc preservation are our prototype assumptions, not vendor or anatomical rules.",
                        "Actual cubic chord/control-polygon bounds, not formula targets, validate arc lengths.",
                        "Projected model dimensions remain projected; no 3D last, fit or validated heel-posture claim."])


def build_contour_last(inputs):
    total,top,bottom=read_inputs(inputs)
    model,projected_top,projected_bottom=_solve_bottom(total,bottom)
    curves=[bottom_curve_points(model,n) for n in model["profile"]]
    lengths=[_arc(p) for p in curves]
    cache={}
    station_map={}
    dimensions={"length":projected_top["design"]["length"]}
    for name in STATIONS:
        station=top[name+"_s"]
        if station not in cache:
            cache[station]=_map_station(curves,lengths,station)
        y=cache[station]
        station_map[name]=dict(s=station,y=y)
        dimensions[name+"_y"]=y
        dimensions[name+"_width"]=top[name+"_width"]
    top_inputs={"schema_version":1,"units":"mm","design":dimensions}
    top_model=build_model(top_inputs)
    state=dict(inputs=copy.deepcopy(inputs),models=dict(top=top_model,bottom=model),
               derived=dict(projected_length=dimensions["length"],station_map=station_map,
                            bottom_stations=dict(seat_s=bottom["seat_arc_length"],contact_s=bottom["contact_s"],
                                                 blend_end_s=bottom["contact_s"]+bottom["blend_arc_length"])))
    state["reports"]={"top":validate_model(top_model,top_inputs),
                      "bottom":validate_bottom_model(model,projected_top,projected_bottom),
                      "contour":validate_contour_last(state,inputs)}
    return state
