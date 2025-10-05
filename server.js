require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3001;

/* ================= Heuristik lokal ================= */
function repetitionScore(text){
  const words = text.toLowerCase().replace(/[^a-z0-9\- ]/g,' ')
                 .split(/\s+/).filter(w=>w && w.length>3);
  const freq = new Map(); words.forEach(w=>freq.set(w,(freq.get(w)||0)+1));
  const n=words.length; if(!n) return 0;
  const top = [...freq.values()].sort((a,b)=>b-a).slice(0,10).reduce((s,v)=>s+v,0);
  return top/n;
}
function averageSentenceLength(text){
  const sents = text.split(/[.!?]+/).map(s=>s.trim()).filter(Boolean);
  if(!sents.length) return 0;
  const words = sents.map(s=>s.split(/\s+/).filter(Boolean).length);
  return words.reduce((a,b)=>a+b,0)/sents.length;
}
function makeHeuristicEval(payload){
  const { stages } = payload; // [{id,label,words,text}, ...]
  const texts = stages.map(s=>s.text||"");
  const full = texts.join("\n");
  const totalWords = full.split(/\s+/).filter(Boolean).length;
  const lens = texts.map(t=>t.split(/\s+/).filter(Boolean).length);
  const minL = Math.min(...lens), maxL = Math.max(...lens);
  const balance = minL/Math.max(1,maxL);
  let missing = [];
  for(const s of stages){
    const miss = (s.words||[]).filter(k=>!new RegExp("\\b"+k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+"\\b","i").test(s.text||""));
    if(miss.length) missing.push(`${s.label}: ${miss.join(", ")}`);
  }
  const repeat = repetitionScore(full);
  const avgSent = averageSentenceLength(full);
  const recs = [];
  if(totalWords<500) recs.push("Perpanjang narasi hingga ±700–1200 kata untuk versi blog/Medium.");
  if(balance<0.5) recs.push("Samakan panjang antar babak agar ritme cerita konsisten.");
  if(repeat>0.12) recs.push("Kurangi repetisi kata yang sama, gunakan sinonim dan variasi kalimat.");
  if(avgSent>24) recs.push("Pecah kalimat panjang menjadi 2–3 kalimat lebih pendek.");
  recs.push("Susun versi carousel (1 slide per babak) untuk Instagram/LinkedIn.");
  recs.push("Jika idenya kuat, kembangkan jadi esai/cerpen untuk dikirim ke lomba.");

  const coverageOk = missing.length===0;
  const grade = (coverageOk?30:10) + Math.max(0, 20*Math.min(balance,1))
              + (repeat<0.12?20:5) + (avgSent<24?20:10) + (totalWords>800?10:0);
  return {
    mode: "heuristic",
    score: Math.round(grade),
    metrics: { totalWords, balance:+balance.toFixed(2), repetition:+repeat.toFixed(3), avgSentence:+avgSent.toFixed(1) },
    missing,
    recommendations: recs
  };
}

/* =============== (Opsional) IBM Granite =============== */
// Set USE_GRANITE=1 dan install @ibm-cloud/watsonx-ai untuk aktifkan
let useGranite = (process.env.USE_GRANITE === '1');
let WatsonXAI = null, wxa = null;
if (useGranite) {
  try {
    ({ WatsonXAI } = require('@ibm-cloud/watsonx-ai'));
    wxa = WatsonXAI.newInstance({
      version: '2024-05-31',
      serviceUrl: process.env.WATSONX_URL
    });
  } catch (e) {
    console.warn('Granite tidak aktif (package belum di-install). Pindah ke heuristik lokal.');
    useGranite = false;
  }
}

/* ================== API: /ai/eval ================== */
app.post('/ai/eval', async (req, res) => {
  const payload = req.body; // { stages: [{id,label,words,text}, ...], theme }
  if (!payload || !Array.isArray(payload.stages)) {
    return res.status(400).json({ error: 'payload invalid' });
  }

  // 1) default: heuristik lokal
  let result = makeHeuristicEval(payload);

  // 2) jika Granite aktif, coba mintakan saran tambahan (fallback ke heuristik jika gagal)
  if (useGranite && wxa) {
    try {
      const prompt = `
Anda adalah editor sastra. Evaluasi cerita berikut secara singkat (maks 120 kata).
Tema: ${payload.theme}
Ceritakan per-babak secara 1–2 kalimat, lalu berikan 5 rekomendasi praktis (bullet).
Cerita:
${payload.stages.map((s,i)=>`[Babak ${i+1} ${s.label}] kata-wajib: ${s.words.join(', ')}\n${s.text}`).join('\n')}
      `.trim();

      const out = await wxa.generateText({
        input: prompt,
        modelId: process.env.WATSONX_MODEL_ID || 'ibm/granite-3-3-8b-instruct',
        projectId: process.env.WATSONX_PROJECT_ID,
        parameters: { max_new_tokens: 280 }
      });
      const text = out.result?.results?.[0]?.generated_text || '';
      result = { ...result, mode: "granite+heuristic", aiSummary: text };
    } catch (e) {
      console.warn('Granite gagal, pakai heuristik saja:', e.message);
    }
  }
  res.json(result);
});

app.listen(PORT, () => console.log(`Story Maker server on http://localhost:${PORT}`));
