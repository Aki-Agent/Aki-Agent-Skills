// MP4 quality control: resolution, fps, frames, duration, color range, black and frozen stretches.
// Usage: node qc_video.js <video.mp4>
// Exit: 0 clean, 2 black or frozen stretches found, 1 could not run.
const { spawnSync } = require('child_process');
const file = process.argv[2];
if (!file) { console.error('Usage: node qc_video.js <video.mp4>'); process.exit(1); }

const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,width,height,r_frame_rate,nb_frames,pix_fmt,color_range', '-of', 'json', file], { encoding: 'utf8' });
if (probe.error) { console.error('Could not run ffprobe:', probe.error.message); process.exit(1); }
if (probe.status !== 0) { console.error(probe.stderr.trim()); process.exit(1); }
const info = JSON.parse(probe.stdout);

const scan = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-vf', 'scale=640:-1,blackdetect=d=0.3:pix_th=0.05,freezedetect=n=0.0005:d=4', '-an', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
if (scan.error) { console.error('Could not run ffmpeg:', scan.error.message); process.exit(1); }
const issues = scan.stderr.split(/\r?\n/).filter(l => /black_start|freeze_start/.test(l)).map(l => l.replace(/^\[[^\]]*\]\s*/, '').trim());

const v = info.streams[0];
console.log(`${v.width}x${v.height} ${v.codec_name} ${v.pix_fmt} range=${v.color_range} fps=${v.r_frame_rate} frames=${v.nb_frames} duration=${info.format.duration}s size=${info.format.size}`);
console.log(issues.length ? `Black/frozen stretches:\n${issues.join('\n')}` : 'No black or frozen stretches');
console.log(JSON.stringify({ ok: !issues.length, stream: v, format: info.format, issues }));
process.exit(issues.length ? 2 : 0);
