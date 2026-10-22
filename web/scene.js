import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createScene(container) {
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  container.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','3D reference guides. Drag to orbit; scroll to zoom. Use reset view to restore framing.');
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(36,1,.01,10000);
  camera.up.set(0,0,1);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=false;controls.screenSpacePanning=true;
  const guides=new THREE.Group();scene.add(guides);
  let box=new THREE.Box3(),disposed=false;
  function render(){if(!disposed)renderer.render(scene,camera);}
  controls.addEventListener('change',render);
  function fit(){
    if(box.isEmpty())return;
    const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    const radius=Math.max(size.length()/2,1),direction=new THREE.Vector3(1,-.35,.8).normalize();
    const right=new THREE.Vector3().crossVectors(camera.up,direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right);
    const tangent=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
    let distance=1;
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      const delta=new THREE.Vector3(x,y,z).sub(center),depth=delta.dot(direction);
      distance=Math.max(distance,Math.abs(delta.dot(right))/(tangent*camera.aspect)+depth,Math.abs(delta.dot(up))/tangent+depth);
    }
    distance*=1.2;
    controls.target.copy(center);camera.position.copy(center).add(direction.multiplyScalar(distance));
    camera.near=Math.max(distance/1000,.01);camera.far=distance*100;camera.updateProjectionMatrix();
    controls.minDistance=radius*.15;controls.maxDistance=distance*15;controls.update();render();
  }
  function resize(){const width=container.clientWidth,height=container.clientHeight;if(!width||!height)return;const changed=camera.aspect!==width/height;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();if(changed&&!box.isEmpty())fit();else render();}
  const observer=new ResizeObserver(resize);observer.observe(container);
  function clear(){for(const child of [...guides.children]){guides.remove(child);child.geometry.dispose();child.material.dispose();}}
  function update(display){
    clear();box.makeEmpty();
    for(const [kind,color]of [['top',0x216356],['bottom',0xb15d35]])for(const curve of display[kind]){
      const vertices=curve.points.flat();
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
      const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color}));line.name=curve.name;guides.add(line);
      for(const point of curve.points)box.expandByPoint(new THREE.Vector3(...point));
    }
    resize();fit();
  }
  function dispose(){disposed=true;observer.disconnect();controls.removeEventListener('change',render);controls.dispose();clear();renderer.dispose();renderer.domElement.remove();}
  resize();return{update,fit,dispose};
}
