import express from "express";
import cors from "cors";
import morgan from "morgan";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import { existsSync } from "fs";

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || "CHANGE_ME";

// pilih ffmpeg: system > static
const ffmpegPath = existsSync("/usr/bin/ffmpeg") ? "/usr/bin/ffmpeg" : (ffmpegStatic || "ffmpeg");

app.use(express.json({ limit: "1mb" }));
app.use(cors());
app.use(morgan("dev"));

let ff = null, timer = null;
let state = { online:false, target:null, keyMasked:null, startedAt:null, logTail:[] };

const log = s => { state.logTail.push(String(s).trim()); if(state.logTail.length>200) state.logTail.splice(0, state.logTail.length-200); };
const mask = k => (!k ? null : (String(k).length<=6 ? "***" : String(k).slice(0,3)+"****"+String(k).slice(-3)));
const guard = (req,res,next)=> (req.headers["x-api-key"]||"")===ADMIN_SECRET ? next() : res.status(401).json({ok:false,error:"unauthorized"});

function rtmpUrl(target, key, custom){
  if(target==="youtube") return `rtmp://a.rtmp.youtube.com/live2/${key}`;
  if(target==="tiktok")  return `${custom || "rtmps://push-rtmp-global.tiktokglobal.lf127.net/rtmp"}/${key}`;
  if(target==="shopee")  return `${custom}/${key}`;  // biasanya custom dari Shopee Live
  if(target==="custom")  return `${custom}/${key}`;
  throw new Error("unknown target");
}

function startFF(opts={}){
  const {
    target="youtube",
    streamKey="",
    playlist=[],
    loop=true,
    width=1280, height=720, fps=30,
    vBitrate="3000k", aBitrate="128k",
    customRtmp="",
    durationSec=0
  } = opts;

  if(ff) throw new Error("already_running");
  if(!playlist?.length) throw new Error("empty_playlist");

  const input = playlist[0];                 // 1 file dulu (stabil & hemat CPU)
  const out   = rtmpUrl(target, streamKey, customRtmp);

  const args = [
    "-re", "-stream_loop", loop ? "-1" : "0",
    "-i", input,
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    "-r", `${fps}`,
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-pix_fmt", "yuv420p",
    "-b:v", vBitrate, "-maxrate", vBitrate, "-bufsize", "2M",
    "-c:a", "aac", "-b:a", aBitrate, "-ar", "44100", "-ac", "2",
    "-f", "flv", out
  ];

  log(`[spawn] ${ffmpegPath} ${args.join(" ")}`);
  ff = spawn(ffmpegPath, args);
  state.online = true; state.target = target; state.keyMasked = mask(streamKey); state.startedAt = new Date().toISOString();

  ff.stdout.on("data", d => log(d.toString()));
  ff.stderr.on("data", d => log(d.toString()));
  ff.on("close", code => { log(`[ffmpeg] exit ${code}`); cleanup(); });

  if(durationSec>0){
    timer = setTimeout(()=>{ log(`[timer] auto-stop ${durationSec}s`); stopFF(); }, durationSec*1000);
  }
}
function stopFF(){ if(timer){clearTimeout(timer);timer=null} if(ff){ try{ff.kill("SIGINT")}catch{} } cleanup(); }
function cleanup(){ if(ff){ try{ff.kill("SIGKILL")}catch{} } ff=null; state.online=false; state.target=null; state.keyMasked=null; state.startedAt=null; }

app.get("/", (_req,res)=>res.json({ok:true, service:"autolive-render", online:state.online}));
app.get("/status", guard, (_req,res)=>res.json({ok:true, ...state}));
app.get("/logs", guard, (_req,res)=>res.type("text/plain").send(state.logTail.join("\n")));
app.post("/start", guard, (req,res)=>{ try{ startFF(req.body||{}); res.json({ok:true, started:true}); }catch(e){ res.status(400).json({ok:false,error:e.message}); }});
app.post("/stop",  guard, (_req,res)=>{ stopFF(); res.json({ok:true, stopped:true}); });

app.listen(PORT, ()=>console.log(`✅ streamer ready on :${PORT} (ffmpeg: ${ffmpegPath})`));
