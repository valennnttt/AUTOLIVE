import express from "express";
import cors from "cors";
import morgan from "morgan";
import { spawn } from "child_process";

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || "CHANGE_ME";

let ff = null, timer = null;
let state = { online:false, startedAt:null, logTail:[] };

const log = s => { state.logTail.push(String(s).trim()); if(state.logTail.length>200) state.logTail.splice(0, state.logTail.length-200); };
const guard = (req,res,next)=> (req.headers["x-api-key"]||"")===ADMIN_SECRET ? next() : res.status(401).json({ok:false,error:"unauthorized"});

app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

app.get("/", (_req,res)=>res.send("AutoLive Backend Jalan 🚀"));

app.get("/status", guard, (_req,res)=>res.json({ok:true, ...state}));
app.get("/logs", guard, (_req,res)=>res.type("text/plain").send(state.logTail.join("\n")));

app.post("/start", guard, (req,res)=>{
  if(ff) return res.status(400).json({ok:false,error:"already_running"});

  // cara 1: kirim RTMP lengkap
  // body: { rtmpUrl: "rtmp://a.rtmp.youtube.com/live2/STREAMKEY", input: "https://..." }
  const { rtmpUrl, input, durationSec=0 } = req.body || {};
  if(!rtmpUrl) return res.status(400).json({ok:false,error:"rtmpUrl required"});
  const inUrl = input || "https://samplelib.com/lib/preview/mp4/sample-5s.mp4"; // video demo

  const args = [
    "-re", "-stream_loop", "-1",
    "-i", inUrl,
    "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
    "-r", "30",
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-pix_fmt", "yuv420p",
    "-b:v", "3000k", "-maxrate", "3000k", "-bufsize", "2M",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
    "-f", "flv", rtmpUrl
  ];

  log(`[spawn] ffmpeg ${args.join(" ")}`);
  ff = spawn("ffmpeg", args);
  state.online = true;
  state.startedAt = new Date().toISOString();

  ff.stdout.on("data", d => log(d.toString()));
  ff.stderr.on("data", d => log(d.toString()));
  ff.on("close", code => { log(`[ffmpeg] exit ${code}`); cleanup(); });

  if(durationSec>0){
    timer = setTimeout(()=>{ log(`[timer] stop after ${durationSec}s`); stop(); }, durationSec*1000);
  }

  res.json({ok:true, started:true});
});

function stop(){
  if(timer){ clearTimeout(timer); timer=null; }
  if(ff){ try{ ff.kill("SIGINT"); }catch{} }
  cleanup();
}
function cleanup(){ if(ff){ try{ ff.kill("SIGKILL"); }catch{} } ff=null; state.online=false; state.startedAt=null; }

app.post("/stop", guard, (_req,res)=>{ stop(); res.json({ok:true, stopped:true}); });

app.listen(PORT, ()=>console.log(`✅ server on :${PORT}`));
