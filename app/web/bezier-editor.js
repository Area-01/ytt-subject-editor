const ns='http://www.w3.org/2000/svg';

/** Graph coordinates represent time on X and progress on Y. */
export function createBezierEditor(container, initial, onChange) {
  let curve=[...initial];
  const svg=document.createElementNS(ns,'svg'); svg.setAttribute('viewBox','-5 -5 110 110'); svg.setAttribute('role','img'); svg.setAttribute('aria-label','속도 곡선 베지어 제어점'); svg.classList.add('bezier-graph');
  const path=document.createElementNS(ns,'path'); path.classList.add('bezier-line'); svg.append(path);
  const lines=[0,1].map(()=>{const line=document.createElementNS(ns,'line');line.classList.add('bezier-handle');svg.append(line);return line;});
  const circles=[0,1].map(index=>{
    const circle=document.createElementNS(ns,'circle'); circle.setAttribute('r','4');circle.classList.add('bezier-point');
    circle.addEventListener('pointerdown',event=>{event.preventDefault();circle.setPointerCapture(event.pointerId);});
    circle.addEventListener('pointermove',event=>{
      if(!circle.hasPointerCapture(event.pointerId))return;
      const rect=svg.getBoundingClientRect(); if(!rect.width || !rect.height)return;
      const x=(event.clientX-rect.left)/rect.width*110-5, y=(event.clientY-rect.top)/rect.height*110-5;
      curve[index*2]=Math.max(0,Math.min(1,x/100)); curve[index*2+1]=Math.max(0,Math.min(1,1-y/100));
      update(); onChange([...curve]);
    });
    svg.append(circle);return circle;
  });
  function update() {
    const [x1,y1,x2,y2]=curve;
    path.setAttribute('d',`M 0 100 C ${x1*100} ${100-y1*100}, ${x2*100} ${100-y2*100}, 100 0`);
    const endpoints=[[0,100,x1*100,100-y1*100],[100,0,x2*100,100-y2*100]];
    lines.forEach((line,i)=>{const [x1,y1,x2,y2]=endpoints[i];line.setAttribute('x1',x1);line.setAttribute('y1',y1);line.setAttribute('x2',x2);line.setAttribute('y2',y2);});
    circles.forEach((circle,i)=>{circle.setAttribute('cx',curve[i*2]*100);circle.setAttribute('cy',100-curve[i*2+1]*100);});
  }
  container.append(svg);update();
  return {setCurve(value){curve=[...value];update();},destroy(){svg.remove();}};
}
