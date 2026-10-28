// 머리 위 스프라이트(캔버스). 셀 라벨(view.js)과 같은 카드 모양을 작은 크기로.
import * as THREE from 'three';

export const TAG = Object.freeze({ w: 384, h: 96, scale: 2.3 });

export function makeTag({ scale = TAG.scale } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = TAG.w;
  canvas.height = TAG.h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(scale, scale * TAG.h / TAG.w, 1);
  sprite.renderOrder = 11;
  sprite.name = 'tag';
  sprite.raycast = () => {};
  return { sprite, canvas, tex, key: '', scale };
}

export function paintTag(tag, { title, sub, color, selected }) {
  const key = `${title}|${sub}|${color}|${!!selected}`;
  if (key === tag.key) return;
  tag.key = key;
  const ctx = tag.canvas.getContext('2d');
  const { w, h } = TAG;
  ctx.clearRect(0, 0, w, h);
  const col = `#${(color >>> 0).toString(16).padStart(6, '0')}`;
  roundRect(ctx, 4, 4, w - 8, h - 8, 16);
  ctx.fillStyle = selected ? 'rgba(18,28,40,0.94)' : 'rgba(14,17,22,0.82)';
  ctx.fill();
  ctx.lineWidth = selected ? 5 : 3;
  ctx.strokeStyle = col;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 32px system-ui, "Malgun Gothic", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(title ?? ''), 22, 34);
  ctx.fillStyle = '#c4ccd6';
  ctx.font = '24px system-ui, "Malgun Gothic", sans-serif';
  ctx.fillText(String(sub ?? ''), 22, 68);
  tag.tex.needsUpdate = true;
}

export function disposeTag(tag) {
  tag.tex.dispose();
  tag.sprite.material.dispose();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
