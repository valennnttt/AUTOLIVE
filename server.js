import express from "express";
import { exec } from "child_process";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("AutoLive Backend Jalan 🚀"));

app.get("/start", (req, res) => {
  const url = req.query.url; // rtmp url (youtube/tiktok/shopee)
  if (!url) return res.send("RTMP URL kosong!");
  
  const cmd = `ffmpeg -re -stream_loop -1 -i input.mp4 -c copy -f flv ${url}`;
  const proc = exec(cmd);

  proc.on("exit", (code) => {
    console.log("FFmpeg exit", code);
  });

  res.send("Livestream dimulai!");
});

app.listen(PORT, () => console.log(`Server jalan di port ${PORT}`));
