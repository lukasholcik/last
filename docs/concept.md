# A tool for designing a shoe last

A last is the solid form that a shoe is made around. It is not simply a copy of a foot:
its shape also depends on the shoe we want to make, its materials, and how it is put together.

This is a working discussion document, not a finished implementation plan.
The prototypes generate a numeric top outline and a separate longitudinal bottom guide with SVG diagrams.
The browser viewer contract adds numeric editing, 2D views, and rotatable 3D reference guides, not a last surface.
The current application uses Next.js/React/TypeScript with tRPC and one production TypeScript geometry module;
Python/SVG tools remain reference experiments, not browser runtime dependencies.
Edits do not overwrite example files and there is no save feature yet. React/browser acceptance is separate from the numeric/API review.
Its new designed last-length target is **250 mm along the bottom contour**, not the previous 250 mm projection.
This deliberately creates a new shape rather than preserving the old baseline. Legacy projected experiments remain unchanged.
Below, **agreed** means decided, **recommended** means a suggestion, and **still to decide** means an open question.

## What we're aiming for — agreed

- A personal project: eventually print a last and make a shoe fitted to your own foot.
- Start with ballet flats. A last for these is not automatically suitable for every kind of shoe.
- Build and try the modelling tool with example measurements first. Measure your own foot much later.
- You know Blender and have tried some shoe patterns, but are still learning shoemaking.
- Do not use the existing wrong-size high-heel last as a starting shape or reference to transform.
- Control most of the shape with numbers, with optional Bézier curves or handles for finer adjustments.
- Show the same model from the top, from the side, and in 3D.
- Keep chosen dimensions in charge: a curve edit must not quietly change them.
- Describe last heel height and toe spring relative to horizontal ground, using the sourced definitions below.
  The bottom profile belongs to the last, not a foot outline. No sole-thickness or separate sole-stack inputs.
- Work first on the foot/last outline seen from above, then the elevation and bottom seen from the side,
  then the upper surface, which is likely the hardest part. Arch shaping can come later if needed.
- The first outline is the outer silhouette seen from above, not the edge of the last's bottom.
- Name every point and line, including reference lines and curve handles, so the diagram and code use the same terms.
- Make generated diagrams available as rendered images for visual review, not just SVG source.
- Treat toe labels as starting presets: you can adjust between “round”, “almond”, and “pointed”.
- Keep shoe construction in the discussion; it affects what shape will work.
- Consult internet sources for every last-design decision. Separate established definitions,
  a particular vendor's conventions, and our own modelling assumptions.

## Keep three kinds of numbers separate — agreed

| Kind | What it means | Example |
| --- | --- | --- |
| Measured | Something actually observed on a foot | A measured forefoot width |
| Assumed | A guess where information is missing | The shape between two measured points |
| Designed | Something deliberately chosen for the last | Its toe extension or intended width |

A measured foot width and a chosen last width can be different. Keep both rather than replacing one.
Extra toe space or changes to the distance around the foot need a reason and later testing;
we have not established universal rules for either.
Materials, patterns, and construction can change what is needed.

For each number, say where it came from and whether it is measured, guessed, or chosen.
If a measurement is uncertain, say so. Missing information should not look like an exact fact.
Also make clear whether a number describes the foot, the guiding points and curves, or the resulting 3D model.

We also agree to distinguish **entered numbers** from **calculated numbers**.
This is a separate distinction: a chosen design value can be either entered or calculated.
For example, we could calculate last length from reference foot length plus chosen toe extension.
That formula and which values can be edited directly are recommendations, not yet settled rules.
Show which numbers are calculated and what they depend on; never change recorded foot measurements silently.

## Example measurements for development

You asked to start with example measurements based on averages rather than your own foot.
Until we choose a named dataset describing a particular group of people, call these **made-up example measurements**,
not true population averages. `examples/baseline.json` now supplies made-up design values for the first prototype.
Even if an example fills a field called “foot width”, label it as an example, not a real observation.

**Recommended:** try a starting example, a wider forefoot, a higher instep, and different toe arrangements.
This set is still to decide. It would test the tool, not prove that it represents all feet or fits anyone.

## What the tool might describe

These are candidate inputs, not a shopping list of measurements you need to take now.

| Part | Information we might record | Shape we might choose |
| --- | --- | --- |
| Length | Foot length | Last length and extra length beyond the toes |
| Forefoot | Width near the ball of the foot | Width along the front and where it starts narrowing |
| Outline | Positions of selected points around the foot | The outline of the last between those points |
| Distance around the foot | Measurements around selected places | Size and shape of those sections of the last |
| Instep | Height and shape over the top of the foot | The upper shape of the last |
| Heel | Heel width and shape | The heel region and its support shape |
| Toes | How far toes reach and how much height they need | The last's toe shape |
| Last heel height / toe spring | No personal measurements needed for this development step | Rear and toe underside heights above ground |
| Bottom | Useful foot observations, if available | The bottom curve and shape |
| Local details | Usually not separate foot measurements | Small curve adjustments |

The first prototype uses millimetres and records the units explicitly.
Before modelling, agree what each number means and how point positions are written:
where we measure from, which direction is forward, and which is up.
For example, everyone should interpret “width at this point” the same way.
The foot outline will use numbered point positions; a photograph is not required.
Exactly which points to use and how to measure them remain to be worked out.
Actual foot-measuring tools, standing position, weight on the foot, and repeat checks can wait until personal adaptation.

## Toe shape — recommended controls

“Round” or “pointed” would fill in starting values, not lock the toe into a category.
Possible controls are:

- Extra length beyond the reference toes: example toes now, your own toes later.
- Where the front starts to narrow.
- How much it narrows on the big-toe side and the little-toe side.
- Where the tip sits and how wide it is.
- How rounded the tip and the surrounding transitions are.
- How the toe height changes along its length and across its width.

These controls may affect one another. Useful combinations and limits still need testing.
Show the preset's numbers and guesses. A nice-looking toe does not prove there is enough room inside a shoe.
Checking toe space is agreed. Showing a reference foot or toe outline over the last is an optional aid,
not a required display; how to check the space still needs defining.

## Numbers, curves, and dragging

**Agreed first experiment:** generate an SVG outline from numbers, without interactive editing.
This lets us check the shape rules before building editing tools or a 3D surface.
The first version uses mm, named cubic curves, one rounded toe style, and independently positioned ball regions.
Side widths are distances from the centre line at each side's own forward position;
their sum is not a single section width when those positions differ.
Handles and full section widths are calculated, not separate editable numbers.
The browser now enters top locations as contour stations `_s`, measured along the bottom guide.
It calculates their forward positions separately; widths remain entered distances from the centre line at those positions.
One `contour_last` document supplies last contour length and all controls. There is no second editable projected length.
When heel height changes, the seat, waist, blend, and ramp keep their respective contour lengths; the top's forward
positions follow their mapped stations. This is our explicit prototype assumption, not an anatomical or vendor rule.
Seat inclination stays editable; impossible height/length/angle combinations are rejected, not silently redistributed.
See [README](../README.md) for commands, shape assumptions, and curve-based checks to 0.1 mm.

**Agreed direction:** our own browser-first app, with geometry calculated independently of its display.
Keep one production geometry implementation rather than separate browser and Blender versions of the shape rules.
**Current implementation:** an actual create-t3-app scaffold, adapted to Next.js 16 App Router, React, TypeScript,
Tailwind CSS, and tRPC; locally installed Three.js displays the guides. `src/lib/geometry` is independent of rendering and transport.
The earlier plain HTML/JavaScript viewer and Python geometry are temporary comparison references, not a second production service.
There is no authentication, database, or automatic persistence. See [README](../README.md) for the pnpm-only setup.
The top guide is shown at z=0 and the side guide at x=0 only for display. These reference lines do not define
a 3D last, an anatomical centreline, or the edge of a bottom surface. The 2D views share one uniform scale;
the sampled 3D lines are for inspection, not precise measurements.
Blender may be an optional export destination, not the primary app or a required geometry engine.
Attach controls to named regions such as the heel or toe, relative to the guiding shape,
not to vertex numbers that may change when the mesh is rebuilt.
Keep those editable controls; the output mesh alone is not the saved design.
Rebuild explicitly, carrying local adjustments onto the updated shape.
Edits must clear passed status immediately. Last-valid results are reference-only until a successful rebuild of the current revision;
an older response must not overwrite later edits or reinstate a stale success claim.
Exactly how future draggable controls stay attached is still to decide. The current viewer edits numbers only.

There are two suggested ways to drag things; you have not yet chosen whether you want both:

- **Dimension points:** dragging a width point, for example, explicitly changes the chosen last-width number.
  Show that change. It must never overwrite a recorded foot measurement.
- **Contour handles:** dragging these refines a curve while keeping the chosen dimensions unchanged.

If a curve edit conflicts with a dimension, the tool must say so, not silently change the number.
Still to decide: refuse the edit, stop it at the limit, or move the handle to a nearby allowed position.
If the tool adjusts a handle, show what changed. If rebuilding cannot keep an edit, report that too.
We still need to define how smoothly adjoining curves should meet and what makes a usable, unbroken model.

## Last heel height, toe spring, and the bottom

The rough flow is: example or measured foot information + stated guesses → chosen last dimensions
→ guiding points and curves → resulting 3D model → printed last → test shoe → fit changes.
Toe settings, the bottom shape, and heel elevation can affect several parts of the model along the way.

The [ISO 19408:2023 preview](https://cdn.standards.iteh.ai/sist-preview/83107/cb5f303e387a42a6842831f8721fb244/ISO-19408-2023.pdf)
defines last heel height from the rear underside to ground in normal orientation (§3.2.6),
the heel seat (§3.2.7), and toe spring from the toe underside to ground (§3.2.13).
Toe spring is a height here, not an angle. For our proposed drawing, horizontal ground is z=0.
These replace the loose “tip of heel” and “front of foot” descriptions, not the existing top-outline inputs.

The approved [bottom-profile specification](bottom-profile.md) now has a numeric/SVG experiment.
Its new contour-length adapter reuses the same shape constructors, with a separate input format and tight arc-length checks.
It describes a side-view guide through the heel seat, waist, rounded contact transition, and straight inclined forepart,
not a validated 3D bottom. You approved a 10 mm development transition instead of the rejected S-shaped toe rise;
this is an explicit design choice, not an anatomical default. The positive-height toe does not flatten again.
The breast is the front of the heel seat; the tread is the forepart contact region
([Bird anatomy reference](https://shoemaking.wiki/The_Anatomy_of_a_Shoe_Last)).
Neither endpoint heights nor these names determine the whole curve. Curve rules remain our assumptions to state and check.

Raising the heel is not just rotating an unchanged foot or last. Posture can change the shape needed.
We have not chosen a tested formula for changing the last with heel elevation.
Research about posture does not provide that formula. How elevation and the bottom shape work together is still open.

## Recommended steps

1. Define the numbers, point positions, and clearly labelled made-up examples.
2. Start with the foot/last outline from above, including the forefoot and toe controls; check chosen dimensions.
3. Try the implemented bottom-guide experiment, using sourced last heel height and toe spring; review the rendered shape.
   Inspect both guides in the browser and rebuild after numeric edits without changing the example files.
4. Build the upper surface and check joins and all three views. Add arch shaping later only if needed.
5. Much later, agree how to measure your foot, collect those measurements, and adapt the design.
6. Print the personal last and compare its dimensions with the digital model.
7. Make a test shoe and check that the last can be removed.
8. Try the actual shoe and adjust the design. You will diagnose fit issues; no elaborate fit workflow is required.
9. Extend the first browser viewer only as later geometry and checks are approved; Blender export is optional.

See [software research](software-research.md) for existing tools, image examples, and suggested top-outline controls.
The first outline describes the outer silhouette seen from above. The edge of the last's bottom is a separate curve,
to be defined later; do not treat the silhouette as a sole outline.

You can print example shapes earlier to test printing or dimensions, without claiming personal fit.
Printing material, process, orientation, splitting/removal, and construction are still to decide.
Consider those risks early, including strength and the smoothness of any split or join.

## How we'll check it works

- Measure chosen dimensions on the actual resulting 3D model, not just its controls or displayed numbers.
- Decide how close is close enough; measurement methods and allowed errors are still to decide.
- Check that local edits survive rebuilding, saving, reopening, and changes to the main dimensions.
- Check that top, side, and 3D views agree and that tested settings do not produce broken or unusable surfaces.
  Define those checks and the tested settings before claiming success.
- Inspect printed dimensions. A matching print proves neither comfort nor fit.
- Judge fit in an actual shoe, not from the last alone. You will handle diagnosing fit issues.
- Review missing foot information and why chosen last dimensions differ from it before personal fitting.
- Choose the first construction, upper/lining/sole materials, and pattern approach before relying on fit results.

## References and what they can tell us

Excerpts and summaries do not establish every claim in a full source.
In particular, a standard's public listing is not its full text. None of these links guarantees fit.

- [ISO 19409](https://www.iso.org/standard/81028.html): last measurement terminology and methods;
  exact requirements need the full standard, not just its listing.
- [SATRA 3528](https://www.satra.com/bulletin/article.php?id=3528) and [SATRA 877](https://www.satra.com/bulletin/article.php?id=877):
  last/fit reading; check the relevant detail and context before adopting a method or allowance.
- [Toe-control study](https://doi.org/10.1088/1757-899X/520/1/012017): ideas for adjustable toe shapes,
  not proof that our suggested controls will fit a foot.
- [Heel-posture study](https://link.springer.com/article/10.1186/s40691-023-00347-7): evidence about posture changes,
  not a universal recipe for reshaping a last.
- [Printed-last study](https://doi.org/10.1051/matecconf/201929004001): printing evidence for its particular process,
  not approval of every material or printing method.
- Blender [properties](https://docs.blender.org/api/current/bpy.props.html) and [curves](https://docs.blender.org/api/current/bpy.types.Curve.html):
  ways to build numeric and curve controls, not a ready-made system that keeps all dimensions correct.
