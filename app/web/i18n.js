import korean from './locale-ko.js';

// Register future language catalogs by locale code; absent keys fall back to Korean.
const catalogs={ko:korean};
const bindings={
  'title':'app.name','header strong':'app.name','.badge':'app.development',
  'label:has(> #videoFile)':'file.video','label:has(> #subtitleFile)':'file.subtitles','label:has(> #projectFile)':'file.projectOpen','#saveProject':'file.projectSave',
  'label:has(> #quality)':'output.quality','#quality option[value=optimized]':'output.optimized','#quality option[value=high]':'output.high','#estimate':'output.estimate','#export':'output.export',
  '.preview-head':'preview.title','.preview-head span':'preview.warning','#previous':'preview.previous','#next':'preview.next','label:has(> #fps)':'preview.fps',
  'aside h2':'cue.properties','#empty':'cue.select','label:has(> #cueText)':'cue.text','label:has(> #cueStart)':'cue.start','label:has(> #cueEnd)':'cue.end','#apply':'cue.apply',
  '#effectPanel legend':'effect.title','label:has(> #effectScope)':'effect.scope','#effectScope option[value=all]':'effect.all','#effectScope option[value=word]':'effect.word','#effectScope option[value=character]':'effect.character','#effectScope option[value=custom]':'effect.custom',
  'label:has(> #groupBoundaries)':'effect.boundaries','label:has(> #stagger)':'effect.stagger','label:has(> #staggerDirection)':'effect.order','#staggerDirection option[value=forward]':'effect.forward','#staggerDirection option[value=reverse]':'effect.reverse',
  'label:has(> #effectProperty)':'effect.property','#effectProperty option[value=opacity]':'effect.opacity','#effectProperty option[value=color]':'effect.color','#effectProperty option[value=position]':'effect.position','#effectProperty option[value=size]':'effect.size','#effectProperty option[value=backgroundColor]':'effect.background','#effectProperty option[value=backgroundOpacity]':'effect.backgroundOpacity','#effectProperty option[value=edgeColor]':'effect.edgeColor',
  'label:has(> #effectStart)':'effect.startValue','label:has(> #effectEnd)':'effect.endValue','label:has(> #effectEase)':'effect.speed','#effectEase option[value=linear]':'effect.linear','#effectEase option[value=ease-in]':'effect.easeIn','#effectEase option[value=ease-out]':'effect.easeOut','#effectEase option[value=ease-in-out]':'effect.easeBoth','#applyEffect':'effect.apply','#removeEffect':'effect.remove',
  '.timeline-head strong':'timeline.title','#addTrack':'timeline.addTrack','#addCue':'timeline.addCue','label:has(> #zoom)':'timeline.zoom'
};
export function translate(key,locale='ko') { return catalogs[locale]?.[key] ?? korean[key] ?? key; }
export function applyLocale(root,locale='ko') {
  for (const [selector,key] of Object.entries(bindings)) {
    const element=root.querySelector(selector); if(!element) continue;
    const value=translate(key,locale);
    if (!element.children.length) element.textContent=value;
    else {
      const text=[...element.childNodes].find(node=>node.nodeType===3 && node.nodeValue.trim());
      if(text) text.nodeValue=value+' ';
    }
  }
}
