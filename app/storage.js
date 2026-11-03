import {readFile,writeFile,mkdir,rename,unlink,copyFile,realpath,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';

/** Known data files only. Changes copy rather than move, leaving originals intact. */
export function createStorage(defaultDirectory) {
  const settingsRoot=resolve(defaultDirectory);
  let activeDirectory=settingsRoot;
  const ready=(async()=>{
    try {
      const settings=JSON.parse(await readFile(join(settingsRoot,'location.json'),'utf8'));
      if (settings.version!==1 || typeof settings.directory!=='string' || !isAbsolute(settings.directory)) throw new Error('저장 위치 설정이 올바르지 않습니다.');
      activeDirectory=resolve(settings.directory);
    } catch(error) { if (error.code!=='ENOENT') throw error; }
  })();
  ready.catch(()=>{}); // Keep startup errors available to API callers without an unhandled rejection.
  let queue=Promise.resolve();
  const enqueue=operation=>{ const result=queue.catch(()=>{}).then(async()=>{await ready; return operation();}); queue=result; return result; };
  const filename=kind=>{ if (!['recovery','presets'].includes(kind)) throw new Error('알 수 없는 저장 유형입니다.'); return `${kind}.json`; };
  async function atomicWrite(dir,name,text) {
    await mkdir(dir,{recursive:true});
    const temp=join(dir,`.ytt-${randomUUID()}.tmp`);
    try { await writeFile(temp,text,{encoding:'utf8',flag:'wx'}); await rename(temp,join(dir,name)); }
    finally { await unlink(temp).catch(()=>{}); }
  }
  return {
    read:kind=>enqueue(()=>readFile(join(activeDirectory,filename(kind)),'utf8')),
    write:(kind,text)=>enqueue(()=>atomicWrite(activeDirectory,filename(kind),text)),
    settings:()=>enqueue(()=>({directory:activeDirectory,defaultDirectory:settingsRoot})),
    changeDirectory:directory=>enqueue(async()=>{
      if (typeof directory!=='string' || !isAbsolute(directory) || directory.includes('\0')) throw Object.assign(new Error('절대 경로를 입력하세요.'),{code:'INVALID_PATH'});
      const target=resolve(directory);
      await mkdir(target,{recursive:true});
      await mkdir(activeDirectory,{recursive:true});
      const sourceReal=await realpath(activeDirectory), targetReal=await realpath(target);
      if (sourceReal.toLowerCase()===targetReal.toLowerCase()) return {directory:activeDirectory,defaultDirectory:settingsRoot};
      // Any pre-existing destination data stops the switch; never overwrite it.
      for (const name of ['recovery.json','presets.json']) {
        try { await access(join(targetReal,name)); throw Object.assign(new Error(`대상 폴더에 ${name} 파일이 이미 있습니다.`),{code:'DEST_EXISTS'}); }
        catch(error) { if (error.code!=='ENOENT') throw error; }
      }
      // Probe target write permission before copying any existing data.
      const probe=join(targetReal,`.ytt-probe-${randomUUID()}.tmp`);
      try { await writeFile(probe,'',{flag:'wx'}); } finally { await unlink(probe).catch(()=>{}); }
      for (const name of ['recovery.json','presets.json']) {
        const source=join(sourceReal,name);
        try { await access(source); }
        catch(error) { if (error.code==='ENOENT') continue; throw error; }
        await copyFile(source,join(targetReal,name),constants.COPYFILE_EXCL);
      }
      await atomicWrite(settingsRoot,'location.json',JSON.stringify({version:1,directory:targetReal},null,2));
      activeDirectory=targetReal;
      return {directory:activeDirectory,defaultDirectory:settingsRoot};
    })
  };
}
