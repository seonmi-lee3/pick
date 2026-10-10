// 공유용 페이지의 잠금 화면. scripts/build-share.mjs가 share/lock.js로 복사한다.
// 자료는 비밀번호로 잠근 파일(data.bin) 하나에 들어 있다. 맞는 비밀번호를 넣어야 풀리고,
// 풀린 자료는 app.js가 받아서 화면을 그린다. 비밀번호와 풀린 자료는 어디에도 보내지 않는다.

const ITERATIONS = 600000; // build-share.mjs와 같은 값이어야 한다

let unlock;
window.sharedData = new Promise((resolve) => { unlock = resolve; });

const form = document.getElementById('lockForm');
const input = document.getElementById('lockInput');
const button = document.getElementById('lockButton');
const message = document.getElementById('lockMessage');
let locked = null; // 한 번 내려받은 잠긴 파일

async function open(password) {
  if (!locked) {
    const response = await fetch('data.bin', { cache: 'no-store' });
    if (!response.ok) throw new Error('load');
    locked = new Uint8Array(await response.arrayBuffer());
  }
  const salt = locked.slice(0, 16);
  const iv = locked.slice(16, 28);
  const body = locked.slice(28);
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const packed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, body); // 비밀번호가 틀리면 여기서 실패한다
  const text = await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(text);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!input.value) return;
  button.disabled = true;
  message.textContent = '여는 중입니다…';
  try {
    const data = await open(input.value);
    document.body.classList.remove('locked');
    form.remove();
    unlock(data);
  } catch (error) {
    message.textContent = error.message === 'load'
      ? '자료를 불러오지 못했습니다. 잠시 뒤에 다시 해 주세요.'
      : '비밀번호가 맞지 않습니다.';
    button.disabled = false;
    input.select();
  }
});
