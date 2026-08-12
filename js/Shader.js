const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener("resize", resize);

// =======================
// CONFIG — edite as falas aqui
// =======================
// Cada linha tem um "speaker" (quem fala) e o "text" (a fala em si).
// A lista roda em loop automaticamente, uma fala por vez.
const dialogueLines = [
  { speaker: "UNIDADE 04", text: "O jogo se perdeu no sinal... aguardando reconexão." },
  { speaker: "UNIDADE 04", text: "Não se preocupe. Isso já aconteceu antes." },
  { speaker: "UNIDADE 04", text: "As almas continuam observando, mesmo no silêncio." },
  { speaker: "UNIDADE 04", text: "Sinal instável. Tentando restaurar a transmissão..." },
  { speaker: "UNIDADE 04", text: "Enquanto isso, fique. Eu fico com você." },
  { speaker: "UNIDADE 04", text: "A tela escurece, mas nada se perde de verdade." }
];

// Tempos (em frames, ~60fps)
const TYPING_SPEED   = 2;   // frames por caractere (menor = mais rápido)
const HOLD_TIME      = 150; // quanto tempo a fala fica completa na tela
const FADE_TIME       = 40;  // duração do fade entre falas

// =======================
// ESTADO GLOBAL
// =======================
let time = 0;
let lineIndex   = 0;
let charIndex   = 0;
let typeTimer   = 0;
let holdTimer   = 0;
let fadeTimer   = 0;
let dialoguePhase = "typing"; // typing | holding | fadeout | fadein

// =======================
// ALMAS AMBIENTE (calmas, sem reação a corrupção)
// =======================
const soulOrbs = [];

function createAmbientOrbs() {
  for (let i = 0; i < 10; i++) {
    soulOrbs.push({
      x:       Math.random() * canvas.width,
      y:       canvas.height + Math.random() * canvas.height,
      radius:  Math.random() * 1.5 + 0.6,
      speed:   Math.random() * 0.1 + 0.03,
      drift:   (Math.random() - 0.5) * 0.15,
      alpha:   Math.random() * 0.3 + 0.1,
      flicker: Math.random() * Math.PI * 2
    });
  }
}
createAmbientOrbs();

function updateAmbientOrbs() {
  for (let o of soulOrbs) {
    o.y       -= o.speed;
    o.x       += o.drift;
    o.flicker += 0.025;
    if (o.y < -20) {
      o.y     = canvas.height + Math.random() * 60;
      o.x     = Math.random() * canvas.width;
      o.alpha = Math.random() * 0.3 + 0.1;
    }
  }
}

function drawAmbientOrbs() {
  ctx.save();
  for (let o of soulOrbs) {
    let flick = 0.6 + Math.sin(o.flicker) * 0.4;
    let a     = o.alpha * flick;

    let grad = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.radius * 6);
    grad.addColorStop(0, `rgba(140,200,255,${a})`);
    grad.addColorStop(1, "rgba(140,200,255,0)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.radius * 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(220,240,255,${a})`;
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// =======================
// HUD CALMO (rotação lenta e constante, sem reagir a glitch)
// =======================
let hudRotation = 0;

function drawHUD() {
  const x = canvas.width / 2;
  const y = canvas.height * 0.4;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(hudRotation);

  ctx.strokeStyle = "rgba(0,150,220,.12)";
  ctx.lineWidth   = 2;

  ctx.beginPath(); ctx.arc(0, 0, 170, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 125, 0, Math.PI * 2); ctx.stroke();

  for (let i = 0; i < 16; i++) {
    let angle = (Math.PI * 2 / 16) * i;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * 160, Math.sin(angle) * 160);
    ctx.lineTo(Math.cos(angle) * 178, Math.sin(angle) * 178);
    ctx.stroke();
  }

  ctx.restore();
  hudRotation += 0.0012;
}

// =======================
// TEXTO CENTRAL DE STATUS
// =======================
function drawStatusText() {
  const x = canvas.width / 2;
  const y = canvas.height * 0.4;

  ctx.textAlign = "center";

  ctx.font      = "16px monospace";
  ctx.fillStyle = "rgba(120,190,240,0.55)";
  let blink = Math.floor(time * 1.2) % 2 === 0 ? 1 : 0.4;
  ctx.fillStyle = `rgba(120,190,240,${0.55 * blink})`;
  ctx.fillText("SINAL AGUARDANDO RECONEXÃO", x, y - 200);

  ctx.font      = "13px monospace";
  ctx.fillStyle = "rgba(100,170,220,0.4)";
  ctx.fillText("UNIDADE://04 | STATUS: EM ESPERA", x, y + 215);
}

// =======================
// CHUVA DE CÓDIGO (sutil, sem corrupção)
// =======================
const charset = ["0","1","A","SYS","SIG","ERR","404"];
const rainChars = [];

function createRain() {
  for (let i = 0; i < 18; i++) {
    rainChars.push({
      x:     Math.random() * 1920,
      y:     Math.random() * 1100,
      speed: Math.random() * 0.2 + 0.05,
      text:  charset[Math.floor(Math.random() * charset.length)]
    });
  }
}
createRain();

function drawRain() {
  ctx.font      = "12px monospace";
  ctx.fillStyle = "rgba(120,200,240,.24)";

  for (let c of rainChars) {
    ctx.fillText(c.text, c.x, c.y);
    c.y += c.speed;
    if (c.y > 1100) {
      c.y    = -20;
      c.x    = Math.random() * 1920;
      c.text = charset[Math.floor(Math.random() * charset.length)];
    }
  }
}

// =======================
// CAIXA DE DIÁLOGO
// =======================
function updateDialogue() {
  let current = dialogueLines[lineIndex];

  if (dialoguePhase === "fadein") {
    fadeTimer++;
    if (fadeTimer >= FADE_TIME) {
      fadeTimer      = 0;
      dialoguePhase  = "typing";
      charIndex      = 0;
      typeTimer      = 0;
    }

  } else if (dialoguePhase === "typing") {
    typeTimer++;
    if (typeTimer >= TYPING_SPEED) {
      typeTimer = 0;
      charIndex++;
      if (charIndex >= current.text.length) {
        dialoguePhase = "holding";
        holdTimer     = 0;
      }
    }

  } else if (dialoguePhase === "holding") {
    holdTimer++;
    if (holdTimer >= HOLD_TIME) {
      dialoguePhase = "fadeout";
      fadeTimer     = 0;
    }

  } else if (dialoguePhase === "fadeout") {
    fadeTimer++;
    if (fadeTimer >= FADE_TIME) {
      fadeTimer  = 0;
      lineIndex  = (lineIndex + 1) % dialogueLines.length;
      dialoguePhase = "fadein";
    }
  }
}

function drawDialogueBox() {
  let current = dialogueLines[lineIndex];

  let boxW = Math.min(canvas.width * 0.6, 760);
  let boxH = 130;
  let boxX = (canvas.width - boxW) / 2;
  let boxY = canvas.height - boxH - 60;

  let boxAlpha = 1;
  if (dialoguePhase === "fadein")  boxAlpha = fadeTimer / FADE_TIME;
  if (dialoguePhase === "fadeout") boxAlpha = 1 - (fadeTimer / FADE_TIME);

  ctx.save();
  ctx.globalAlpha = boxAlpha;

  ctx.fillStyle = "rgba(0,10,18,0.45)";
  ctx.fillRect(boxX, boxY, boxW, boxH);

  ctx.strokeStyle = "rgba(0,170,230,0.3)";
  ctx.lineWidth   = 2;
  ctx.shadowBlur  = 16;
  ctx.shadowColor = "rgba(0,190,240,0.2)";
  ctx.strokeRect(boxX, boxY, boxW, boxH);
  ctx.shadowBlur = 0;

  // nome do personagem
  ctx.textAlign = "left";
  ctx.font      = "14px monospace";
  ctx.fillStyle = "rgba(140,220,255,0.85)";
  ctx.fillText(current.speaker, boxX + 22, boxY + 30);

  // linha divisória
  ctx.strokeStyle = "rgba(0,170,230,0.15)";
  ctx.beginPath();
  ctx.moveTo(boxX + 20, boxY + 42);
  ctx.lineTo(boxX + boxW - 20, boxY + 42);
  ctx.stroke();

  // texto com efeito de digitação
  let visibleText = dialoguePhase === "fadein"
    ? ""
    : current.text.substring(0, charIndex);

  ctx.font      = "16px monospace";
  ctx.fillStyle = "rgba(225,245,255,0.92)";
  wrapText(visibleText, boxX + 22, boxY + 68, boxW - 44, 22);

  // cursor piscando enquanto digita
  if (dialoguePhase === "typing" && Math.floor(time * 10) % 2 === 0) {
    ctx.fillStyle = "rgba(180,230,255,0.8)";
    ctx.fillText("_", boxX + 22, boxY + 68);
  }

  ctx.restore();
}

function wrapText(text, x, y, maxWidth, lineHeight) {
  let words = text.split(" ");
  let line  = "";
  let curY  = y;

  for (let word of words) {
    let testLine = line + word + " ";
    if (ctx.measureText(testLine).width > maxWidth && line !== "") {
      ctx.fillText(line, x, curY);
      line = word + " ";
      curY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, curY);
}

// =======================
// VINHETA / SCANLINES (sutis, sem peso de glitch)
// =======================
function drawScanlines() {
  for (let y = 0; y < canvas.height; y += 4) {
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(0, y, canvas.width, 1);
  }
}

function drawVignette() {
  let grad = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, 100,
    canvas.width / 2, canvas.height / 2, canvas.width
  );
  grad.addColorStop(0, "transparent");
  grad.addColorStop(1, "rgba(0,0,0,.45)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// =======================
// LOOP
// =======================
function animate() {
  updateAmbientOrbs();
  drawAmbientOrbs();
  drawRain();
  drawHUD();
  drawStatusText();
  drawScanlines();
  drawVignette();

  time += 0.02;
  requestAnimationFrame(animate);
}

animate();