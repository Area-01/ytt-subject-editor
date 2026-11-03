const ns='http://www.w3.org/2000/svg';
export function createPathEditor(stage,video,points,onChange) {
  const svg=document.createElementNS(ns,'svg'); svg.setAttribute('viewBox','0 0 100 100'); svg.setAttribute('preserveAspectRatio','none'); svg.classList.add('path-editor');
  const path=document.createElementNS(ns,'path'); path.classList.add('path-line'); svg.append(path);
  const lines=[0,1].map(()=>{const line=document.createElementNS(ns,'line');line.classList.add('path-handle');svg.append(line);return line;});
  const circles=points.map((point,index)=>{
    const circle=document.createElementNS(ns,'circle'); circle.setAttribute('r','1.5'); circle.classList.add('path-point');
    circle.addEventListener('pointerdown',event=>{event.preventDefault(); circle.setPointerCapture(event.pointerId);});
    circle.addEventListener('pointermove',event=>{
      if(!circle.hasPointerCapture(event.pointerId))return;
      const rect=svg.getBoundingClientRect(); if(!rect.width || !rect.height)return;
      points[index]=[Math.max(0,Math.min(100,(event.clientX-rect.left)/rect.width*100)),Math.max(0,Math.min(100,(event.clientY-rect.top)/rect.height*100))];
      update(); onChange(structuredClone(points));
    });
    svg.append(circle); return circle;
  });
  function resize() {
    const scale=Math.min(stage.clientWidth/(video.videoWidth || 16),stage.clientHeight/(video.videoHeight || 9));
    const w=(video.videoWidth || 16)*scale,h=(video.videoHeight || 9)*scale;
    svg.style.left=`${(stage.clientWidth-w)/2+w*0.02}px`; svg.style.top=`${(stage.clientHeight-h)/2+h*0.02}px`; svg.style.width=`${w*0.96}px`; svg.style.height=`${h*0.96}px`;
  }
  function update() {
    path.setAttribute('d',`M ${points[0][0]} ${points[0][1]} C ${points[1][0]} ${points[1][1]}, ${points[2][0]} ${points[2][1]}, ${points[3][0]} ${points[3][1]}`);
    [[0,1],[3,2]].forEach(([a,b],i)=>{lines[i].setAttribute('x1',points[a][0]);lines[i].setAttribute('y1',points[a][1]);lines[i].setAttribute('x2',points[b][0]);lines[i].setAttribute('y2',points[b][1]);});
    circles.forEach((circle,i)=>{circle.setAttribute('cx',points[i][0]);circle.setAttribute('cy',points[i][1]);});
  }
  stage.append(svg); const observer=new ResizeObserver(resize); observer.observe(stage); video.addEventListener('loadedmetadata',resize); resize(); update();
  return {destroy(){observer.disconnect();video.removeEventListener('loadedmetadata',resize);svg.remove();}};
}
