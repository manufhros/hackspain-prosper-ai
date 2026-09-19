import { KioskWire, Playback } from './audio.js';
import { copy } from './locale.js';

const $ = id => document.getElementById(id);
let language = 'es', state = 'idle', session = null, resetTimer, errorKey;
const languageButtons = [...document.querySelectorAll('[data-language]')];
let lastAgentMessage;

function followChat() {
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
  $('chat-latest').hidden = true;
}

function appendMessage(message) {
  if (!session || !['user', 'agent'].includes(message.role) || typeof message.text !== 'string' || !message.text.trim()) return;
  const log = $('chat-log');
  const following = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  $('chat-empty').hidden = true;
  const row = document.createElement('div');
  row.className = `chat-message chat-${message.role}`;
  const label = document.createElement('p'); label.className = 'chat-speaker';
  label.textContent = copy[language][message.role === 'user' ? 'chatYou' : 'chatAgent'];
  const text = document.createElement('p'); text.className = 'chat-text'; text.textContent = message.text;
  row.append(label, text); log.append(row);
  if (message.role === 'agent') lastAgentMessage = row;
  if (following) followChat(); else $('chat-latest').hidden = false;
}

function clearChat() {
  $('chat-log').querySelectorAll('.chat-message').forEach(message => message.remove());
  $('chat-empty').hidden = false;
  lastAgentMessage = undefined;
  followChat();
}

function render(next = state) {
  state = next;
  const words = copy[language];
  document.documentElement.lang = language;
  document.title = `${words.reception} · El Turno`;
  document.querySelector('.languages').setAttribute('aria-label', words.language);
  document.querySelector('.brand').setAttribute('aria-label', `El Turno · ${words.back}`);
  for (const element of document.querySelectorAll('[data-copy]')) element.textContent = words[element.dataset.copy];
  const visibleState = session?.muted && ['listening', 'thinking', 'speaking'].includes(state) ? 'paused' : state;
  const [status, title, description] = words[visibleState];
  document.body.dataset.state = visibleState;
  document.body.classList.toggle('session-active', !!session);
  $('chat-panel').hidden = !session;
  $('chat-log').setAttribute('aria-label', words.chatTitle);
  $('status').textContent = status;
  $('title').textContent = title;
  $('description').textContent = state === 'error' && errorKey ? words[errorKey] : description;
  $('start').hidden = !!session || state === 'helpState';
  $('start').querySelector('[data-copy]').textContent = words[state === 'error' ? 'retry' : 'start'];
  $('session-actions').hidden = !session;
  $('mute').disabled = state === 'connecting';
  $('mute').textContent = words[session?.muted ? 'unmute' : 'mute'];
  $('mute').setAttribute('aria-pressed', String(!!session?.muted));
  $('end').textContent = words[state === 'connecting' ? 'cancel' : 'end'];
  $('mic-note').textContent = words[session?.stream ? (session.muted ? 'micPaused' : 'micOn') : 'micOff'];
  $('topics').hidden = !!session || state === 'helpState';
  $('help-panel').hidden = state !== 'helpState';
  for (const button of languageButtons) {
    button.disabled = !!session;
    button.setAttribute('aria-pressed', String(button.dataset.language === language));
  }
}

function release(current) {
  current.abort.abort();
  clearTimeout(current.timeout); clearTimeout(current.deadline);
  if (current.capture) { current.capture.port.onmessage = null; current.capture.disconnect(); current.capture.port.close(); }
  current.source?.disconnect();
  current.stream?.getTracks().forEach(track => track.stop());
  current.playback?.clear();
  if (current.socket) {
    current.socket.onopen = current.socket.onmessage = current.socket.onerror = current.socket.onclose = null;
    current.socket.close();
  }
  if (current.context) { current.context.onstatechange = null; void current.context.close().catch(() => {}); }
}

function finish(next = 'idle', reason) {
  clearTimeout(resetTimer);
  const previous = session; session = null;
  if (previous) release(previous);
  clearChat();
  errorKey = reason;
  render(next);
  if (next !== 'helpState') $('start').focus({ preventScroll: true });
  // No conversation content survives to the next visitor; restore the default locale too.
  if (['ended', 'error', 'helpState'].includes(next)) resetTimer = setTimeout(() => {
    language = 'es'; errorKey = undefined; render('idle');
  }, 30000);
}

function fail(current, reason) { if (session === current) finish('error', reason); }

async function start() {
  if (session) return;
  clearTimeout(resetTimer); errorKey = undefined;
  clearChat();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.AudioWorkletNode) {
    finish('error', 'unsupported'); return;
  }
  const current = { abort: new AbortController(), muted: false };
  session = current; render('connecting'); $('end').focus({ preventScroll: true });
  current.timeout = setTimeout(() => fail(current, 'unavailable'), 20000);
  try {
    // Resume inside the touch gesture, before fetch/permissions break user activation.
    current.context = new AudioContext({ latencyHint: 'interactive' });
    const resumed = current.context.resume();
    void resumed.catch(() => {}); // Handle rejection even if permission/fetch is still pending.
    const response = await fetch('/healthz', { signal: current.abort.signal, cache: 'no-store' });
    if (!response.ok || (await response.json()).ready !== true) throw new Error('unavailable');
    if (session !== current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    if (session !== current) { stream.getTracks().forEach(track => track.stop()); return; }
    current.stream = stream;
    await resumed;
    if (session !== current) return;
    await current.context.audioWorklet.addModule('./capture.js');
    if (session !== current) return;
    for (const track of stream.getAudioTracks()) track.onended = () => fail(current, 'device');
    current.context.onstatechange = () => { if (current.context.state !== 'running') fail(current, 'device'); };
    current.playback = new Playback(current.context, () => { if (session === current) render('listening'); });
    const url = new URL('./ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('language', language);
    const socket = new WebSocket(url); current.socket = socket;
    const wire = new KioskWire(message => {
      if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 16384) throw new Error('Connection behind');
      socket.send(message);
    });
    socket.onopen = () => {
      if (session !== current) return;
      try {
        clearTimeout(current.timeout);
        wire.start();
        current.capture = new AudioWorkletNode(current.context, 'reception-capture');
        current.source = current.context.createMediaStreamSource(stream);
        current.capture.port.onmessage = event => {
          if (session !== current || current.completed) return;
          try { wire.media(event.data); } catch { fail(current); }
        };
        current.source.connect(current.capture); current.capture.connect(current.context.destination);
        current.deadline = setTimeout(() => fail(current, 'timeout'), 180000);
        render('listening'); $('mute').focus({ preventScroll: true });
      } catch { fail(current, 'device'); }
    };
    socket.onmessage = event => {
      if (session !== current) return;
      try {
        const message = JSON.parse(event.data);
        if (message.event === 'edge_message') { appendMessage(message); return; }
        if (message.event === 'edge_message_status') {
          if (message.status === 'audio_incomplete' && lastAgentMessage && !lastAgentMessage.querySelector('.chat-notice')) {
            const notice = document.createElement('p'); notice.className = 'chat-notice';
            notice.textContent = copy[language].chatInterrupted;
            lastAgentMessage.append(notice);
          }
          return;
        }
        if (message.event === 'edge_end') {
          if (message.reason === 'completed') {
            // Preserve the final speaker tail before releasing the device.
            current.completed = true;
            current.stream.getTracks().forEach(track => track.stop());
            current.playback.mark(() => { if (session === current) finish('ended'); });
          } else fail(current, message.reason === 'call_timeout' ? 'timeout' : undefined);
          return;
        }
        if (message.event === 'edge_state') {
          if (['listening', 'thinking'].includes(message.state)) render(message.state);
          return;
        }
        if (message.streamSid !== wire.streamSid) throw new Error('Unexpected stream');
        if (message.event === 'media') { current.playback.push(message.media.payload); if (state !== 'speaking') render('speaking'); }
        else if (message.event === 'clear') { current.playback.clear(); render('listening'); }
        else if (message.event === 'mark') current.playback.mark(() => {
          try { if (session === current && socket.readyState === WebSocket.OPEN) wire.mark(message.mark.name); } catch { fail(current); }
        });
      } catch { fail(current); }
    };
    socket.onerror = () => fail(current, 'unavailable');
    socket.onclose = () => { if (!current.completed) fail(current); };
  } catch (error) {
    const reason = error?.name === 'NotAllowedError' ? 'permission'
      : ['NotFoundError', 'NotReadableError', 'OverconstrainedError'].includes(error?.name) ? 'device'
      : error?.message === 'unavailable' ? 'unavailable' : undefined;
    fail(current, reason);
  }
}

$('start').addEventListener('click', start);
$('chat-latest').addEventListener('click', () => { followChat(); $('chat-log').focus({ preventScroll: true }); });
$('chat-log').addEventListener('scroll', () => {
  if ($('chat-log').scrollHeight - $('chat-log').scrollTop - $('chat-log').clientHeight < 48) $('chat-latest').hidden = true;
});
$('end').addEventListener('click', () => finish());
$('mute').addEventListener('click', () => {
  if (!session?.stream) return;
  session.muted = !session.muted;
  session.stream.getAudioTracks().forEach(track => { track.enabled = !session.muted; });
  render();
});
$('help').addEventListener('click', () => { finish('helpState'); $('help-back').focus({ preventScroll: true }); });
$('help-back').addEventListener('click', () => finish());
for (const button of languageButtons) button.addEventListener('click', () => {
  if (!session) { language = button.dataset.language; render(); }
});
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); finish(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && session) finish(); });
window.addEventListener('pagehide', () => { if (session) finish(); });
window.addEventListener('offline', () => { if (session) finish('error', 'unavailable'); });
// Controls stay disabled if the module fails to load.
for (const button of document.querySelectorAll('button')) button.disabled = false;
render();
