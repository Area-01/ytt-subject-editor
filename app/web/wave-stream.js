import {createFile} from './mp4box.all.mjs';

export function buildAudioEditMap(entries,movieScale,mediaScale) {
  if (!entries?.length) return null;
  if (!(movieScale>0) || !(mediaScale>0)) throw new Error('MP4 시간 기준이 올바르지 않습니다.');
  let cursor=0; const result=[];
  for(const edit of entries) {
    const length=edit.segment_duration/movieScale;
    if (!Number.isFinite(length) || length<0 || edit.media_rate_integer!==1 || edit.media_rate_fraction!==0) throw new Error('지원하지 않는 오디오 편집 목록입니다.');
    if (edit.media_time!==-1) {
      const start=edit.media_time/mediaScale;
      if (!Number.isFinite(start) || start<0 || result.some(item=>start<item.end && start+length>item.start)) throw new Error('반복되는 오디오 편집 구간은 지원하지 않습니다.');
      result.push({start,end:start+length,timelineStart:cursor});
    }
    cursor+=length;
  }
  return result;
}
export function mapAudioMediaTime(seconds,edits) {
  if (!edits) return seconds;
  const edit=edits.find(item=>seconds>=item.start && seconds<item.end);
  return edit ? edit.timelineStart+seconds-edit.start : null;
}

// Incremental MP4 demux and AAC decode. Input bytes never leave the browser.
export async function decodeLargeWave(file,{cancelled=()=>false}={}) {
  if (!globalThis.AudioDecoder || !globalThis.EncodedAudioChunk) throw new Error('이 Chrome에서는 분할 오디오 디코딩을 지원하지 않습니다.');
  const parser=createFile(), peaks=Array.from({length:4096},()=>[1,-1]);
  let info=null, decoder=null, failure=null, duration=0, decoded=0, mapped=0, edits=null;
  parser.onReady=value=>{info=value;};
  parser.onError=message=>{failure=new Error(`MP4 분석 실패: ${message}`);};
  function findSpecific(node) {
    if (!node) return null;
    if (node.tag===5 && node.data?.length) return node.data;
    for(const child of node.descs ?? []) { const value=findSpecific(child); if(value) return value; }
    return null;
  }
  function output(audio) {
    try {
      if (cancelled()) return;
      const frames=audio.numberOfFrames, rate=audio.sampleRate, base=audio.timestamp/1000000;
      for(let channel=0;channel<audio.numberOfChannels;channel++) {
        const values=new Float32Array(frames);
        audio.copyTo(values,{planeIndex:channel,format:'f32-planar'});
        for(let i=0;i<frames;i++) {
          const time=mapAudioMediaTime(base+i/rate,edits);
          if (time===null) continue;
          const index=Math.floor(time/duration*peaks.length);
          if(index<0 || index>=peaks.length) continue;
          peaks[index][0]=Math.min(peaks[index][0],values[i]); peaks[index][1]=Math.max(peaks[index][1],values[i]);
          if(channel===0) mapped++;
        }
      }
      decoded+=frames;
    } catch(error) { failure=error; }
    finally { audio.close(); }
  }
  try {
    let offset=0,configured=false; const chunkSize=2*1024*1024, visits=new Map();
    while(offset<file.size) {
      if(cancelled()) throw new Error('파형 생성을 취소했습니다.');
      visits.set(offset,(visits.get(offset) ?? 0)+1);
      if (visits.get(offset)>3) throw new Error('MP4의 다음 오디오 위치를 찾을 수 없습니다.');
      const buffer=await file.slice(offset,Math.min(file.size,offset+chunkSize)).arrayBuffer();
      buffer.fileStart=offset;
      const proposed=parser.appendBuffer(buffer);
      if(failure) throw failure;
      if(info && !configured) {
        const track=info.audioTracks?.[0] ?? info.tracks?.find(item=>item.audio);
        if(!track || !track.codec?.startsWith('mp4a.40.')) throw new Error('분할 파형은 현재 AAC 오디오가 포함된 MP4만 지원합니다.');
        duration=info.duration/info.timescale;
        if(!Number.isFinite(duration) || duration<=0) throw new Error('영상 길이를 읽을 수 없습니다.');
        const sourceTrack=parser.getTrackById(track.id);
        const entry=sourceTrack?.mdia?.minf?.stbl?.stsd?.entries?.[0];
        edits=buildAudioEditMap(sourceTrack?.edts?.elst?.entries,info.timescale,track.timescale);
        const description=findSpecific(entry?.esds?.esd);
        if(!description) throw new Error('AAC 오디오 설정을 읽을 수 없습니다.');
        const config={codec:track.codec,sampleRate:track.audio.sample_rate,numberOfChannels:track.audio.channel_count,description};
        const support=await AudioDecoder.isConfigSupported(config);
        if(!support.supported) throw new Error('Chrome에서 이 AAC 오디오 형식을 지원하지 않습니다.');
        decoder=new AudioDecoder({output,error:error=>{failure=error;}}); decoder.configure(config);
        parser.onSamples=(id,user,samples)=>{
          for(const sample of samples) {
            if(!sample.data) { failure=new Error('오디오 샘플을 읽을 수 없습니다.'); return; }
            decoder.decode(new EncodedAudioChunk({type:'key',timestamp:Math.round(sample.cts/sample.timescale*1000000),duration:Math.round(sample.duration/sample.timescale*1000000),data:sample.data}));
          }
          if(samples.length) parser.releaseUsedSamples(id,samples[samples.length-1].number+1);
        };
        parser.setExtractionOptions(track.id,null,{nbSamples:128});
        const start=parser.seek(0,false); parser.start(); configured=true;
        offset=Math.max(0,start.offset); continue;
      }
      if(decoder?.decodeQueueSize>512) await decoder.flush();
      if(failure) throw failure;
      if(!Number.isSafeInteger(proposed) || proposed===offset) offset+=buffer.byteLength;
      else if(proposed<0 || proposed>file.size) throw new Error('MP4의 오디오 위치가 파일 범위를 벗어났습니다.');
      else offset=proposed;
    }
    if(!configured) throw new Error('MP4 오디오 트랙을 찾을 수 없습니다.');
    parser.flush(); await decoder.flush();
    if(failure) throw failure;
    if(!decoded || !mapped) throw new Error('영상 시간에 대응하는 오디오 샘플이 없습니다.');
    return peaks.map(([min,max])=>min<=max ? [min,max] : [0,0]);
  } finally { parser.stop(); if(decoder && decoder.state!=='closed') decoder.close(); }
}
