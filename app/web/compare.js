// Screenshots stay in browser memory; no image is sent to the local server.
export function mountComparison(parent) {
  const panel = document.createElement('fieldset');
  panel.className = 'comparison-panel';
  panel.innerHTML = `<legend>화면 비교</legend>
    <p>같은 프레임의 영상 영역만 잘라 저장한 편집기·유튜브 화면을 선택하세요. 유튜브 자막 옵션은 초기화해 주세요.</p>
    <label class="comparison-file">편집기 화면 <input type="file" accept="image/png,image/jpeg"></label>
    <label class="comparison-file">유튜브 화면 <input type="file" accept="image/png,image/jpeg"></label>
    <label>보기 <select><option value="overlay">겹쳐 보기</option><option value="difference">차이 강조</option><option value="first">편집기만</option><option value="second">유튜브만</option></select></label>
    <label>유튜브 화면 투명도 <input type="range" min="0" max="100" value="50"></label>
    <p class="comparison-message" role="status">두 이미지를 선택하세요.</p>
    <canvas aria-label="두 화면 비교 결과"></canvas>
    <p>영상 장면, 캡처 크기, 압축 및 화면 배율의 차이도 차이로 표시됩니다. 이미지는 이 브라우저에서만 처리합니다.</p>`;
  parent.append(panel);
  const inputs = panel.querySelectorAll('input[type=file]');
  const mode = panel.querySelector('select');
  const opacity = panel.querySelector('input[type=range]');
  const message = panel.querySelector('.comparison-message');
  const canvas = panel.querySelector('canvas');
  const bitmaps = [null, null], revisions = [0, 0];
  const buffers = [document.createElement('canvas'), document.createElement('canvas')];
  let ready = false, meanDifference = 0;

  function prepare() {
    ready = false;
    if (!bitmaps[0] || !bitmaps[1]) { message.textContent = '두 이미지를 선택하세요.'; return; }
    const [a, b] = bitmaps;
    if (Math.abs((a.width / a.height) / (b.width / b.height) - 1) > 0.01) {
      message.textContent = '두 이미지의 가로세로 비율이 다릅니다. 영상 영역을 같은 비율로 잘라 주세요.'; return;
    }
    const scale = Math.min(1, 1920 / a.width, 1080 / a.height);
    const width = Math.max(1, Math.round(a.width * scale)), height = Math.max(1, Math.round(a.height * scale));
    canvas.width = width; canvas.height = height;
    for (let i = 0; i < 2; i++) {
      buffers[i].width = width; buffers[i].height = height;
      buffers[i].getContext('2d').drawImage(bitmaps[i], 0, 0, width, height);
    }
    const first = buffers[0].getContext('2d').getImageData(0, 0, width, height);
    const second = buffers[1].getContext('2d').getImageData(0, 0, width, height);
    const diff = new ImageData(width, height);
    let total = 0;
    for (let p = 0; p < first.data.length; p += 4) {
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(first.data[p + c] - second.data[p + c]);
        total += d; diff.data[p + c] = Math.min(255, d * 4);
      }
      diff.data[p + 3] = 255;
    }
    meanDifference = total / (width * height * 3 * 255) * 100;
    const diffCanvas = document.createElement('canvas');
    diffCanvas.width = width; diffCanvas.height = height;
    diffCanvas.getContext('2d').putImageData(diff, 0, 0);
    buffers[2] = diffCanvas;
    ready = true; draw();
  }
  function draw() {
    if (!ready) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (mode.value === 'difference') ctx.drawImage(buffers[2], 0, 0);
    else if (mode.value === 'second') ctx.drawImage(buffers[1], 0, 0);
    else {
      ctx.drawImage(buffers[0], 0, 0);
      if (mode.value === 'overlay') {
        ctx.globalAlpha = Number(opacity.value) / 100;
        ctx.drawImage(buffers[1], 0, 0); ctx.globalAlpha = 1;
      }
    }
    message.textContent = `평균 픽셀 차이 ${meanDifference.toFixed(2)}% · 자막 외 화면 차이도 포함`;
  }
  inputs.forEach((input, index) => input.addEventListener('change', async () => {
    const revision = ++revisions[index];
    bitmaps[index]?.close(); bitmaps[index] = null; ready = false;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    const file = input.files[0];
    if (!file) { prepare(); return; }
    if (file.size > 20 * 1024 * 1024) { message.textContent = '이미지는 각각 20MB 이하여야 합니다.'; return; }
    try {
      const bitmap = await createImageBitmap(file);
      if (revision !== revisions[index]) { bitmap.close(); return; }
      if (bitmap.width * bitmap.height > 40000000) { bitmap.close(); message.textContent = '이미지 크기가 너무 큽니다.'; return; }
      bitmaps[index] = bitmap; prepare();
    } catch {
      if (revision === revisions[index]) message.textContent = '이미지를 읽을 수 없습니다. PNG 또는 JPEG 파일을 선택하세요.';
    }
  }));
  mode.addEventListener('change', draw); opacity.addEventListener('input', draw);
}
