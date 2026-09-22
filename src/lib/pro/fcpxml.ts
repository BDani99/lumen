import type { ProOverlayClip, ProTimeline, ProTimelineClip } from "./timeline";

/**
 * Pro's own FCP7-XML (xmeml) writer. Separate from the classic export route
 * because Pro is multi-track: B-roll on video track 1, transparent overlay
 * PNGs on video track 2, narration on the audio track.
 *
 * Frame positions are derived by rounding cumulative seconds (not each
 * duration independently), which keeps the track gapless after rounding.
 */

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

function escapeXml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fileBlock(params: {
  fileId: string;
  filename: string;
  durationFrames: number;
  isVideo: boolean;
  indent: string;
}): string {
  const { fileId, filename, durationFrames, isVideo, indent } = params;
  const name = escapeXml(filename);
  let x = `${indent}<file id="${fileId}">\n`;
  x += `${indent}  <name>${name}</name>\n`;
  x += `${indent}  <pathurl>file://localhost/./${name}</pathurl>\n`;
  if (isVideo) x += `${indent}  <duration>${durationFrames}</duration>\n`;
  x += `${indent}  <rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>\n`;
  x += `${indent}  <timecode><rate><timebase>${FPS}</timebase></rate><string>00:00:00:00</string><frame>0</frame></timecode>\n`;
  x += `${indent}  <media>\n`;
  if (isVideo) {
    x += `${indent}    <video>\n`;
    x += `${indent}      <duration>${durationFrames}</duration>\n`;
    x += `${indent}      <samplecharacteristics>\n`;
    x += `${indent}        <rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>\n`;
    x += `${indent}        <width>${WIDTH}</width>\n`;
    x += `${indent}        <height>${HEIGHT}</height>\n`;
    x += `${indent}        <pixelaspectratio>square</pixelaspectratio>\n`;
    x += `${indent}        <fielddominance>none</fielddominance>\n`;
    x += `${indent}        <colordepth>24</colordepth>\n`;
    x += `${indent}      </samplecharacteristics>\n`;
    x += `${indent}    </video>\n`;
  } else {
    x += `${indent}    <video><duration>${durationFrames}</duration><samplecharacteristics><width>${WIDTH}</width><height>${HEIGHT}</height></samplecharacteristics></video>\n`;
  }
  x += `${indent}  </media>\n`;
  x += `${indent}</file>\n`;
  return x;
}

/** Ken Burns as Basic Motion scale/centre keyframes. */
function kenBurnsFilter(clip: ProTimelineClip, durationFrames: number, indent: string): string {
  const kb = clip.kenBurns;
  if (!kb) return "";
  const s0 = Math.round(kb.fromScale * 100);
  const s1 = Math.round(kb.toScale * 100);
  const scale =
    `<parameter><parameterid>scale</parameterid><name>Scale</name><valuemin>0</valuemin><valuemax>10000</valuemax>` +
    `<value>${s0}</value><keyframe><when>0</when><value>${s0}</value></keyframe>` +
    `<keyframe><when>${durationFrames}</when><value>${s1}</value></keyframe></parameter>`;
  const center =
    `<parameter><parameterid>center</parameterid><name>Center</name>` +
    `<value><horiz>${kb.fromX}</horiz><vert>${kb.fromY}</vert></value>` +
    `<keyframe><when>0</when><value><horiz>${kb.fromX}</horiz><vert>${kb.fromY}</vert></value></keyframe>` +
    `<keyframe><when>${durationFrames}</when><value><horiz>${kb.toX}</horiz><vert>${kb.toY}</vert></value></keyframe></parameter>`;

  let x = `${indent}<filter>\n`;
  x += `${indent}  <effect>\n`;
  x += `${indent}    <name>Basic Motion</name>\n`;
  x += `${indent}    <effectid>basic</effectid>\n`;
  x += `${indent}    <effectcategory>motion</effectcategory>\n`;
  x += `${indent}    <effecttype>motion</effecttype>\n`;
  x += `${indent}    <mediatype>video</mediatype>\n`;
  x += `${indent}    ${scale}\n`;
  x += `${indent}    ${center}\n`;
  x += `${indent}  </effect>\n`;
  x += `${indent}</filter>\n`;
  return x;
}

type PlacedClip = {
  id: string;
  fileId: string;
  filename: string;
  startFrame: number;
  durationFrames: number;
  isVideo: boolean;
  kenBurns?: ProTimelineClip["kenBurns"];
};

function place(
  items: { startSec: number; durationSec: number; filename: string; isVideo: boolean; kenBurns?: ProTimelineClip["kenBurns"] }[],
  idPrefix: string
): PlacedClip[] {
  const out: PlacedClip[] = [];
  items.forEach((item, i) => {
    const startFrame = Math.round(item.startSec * FPS);
    const endFrame = Math.round((item.startSec + item.durationSec) * FPS);
    const durationFrames = endFrame - startFrame;
    if (durationFrames <= 0) return;
    out.push({
      id: `${idPrefix}_${i}`,
      fileId: `file_${idPrefix}_${i}`,
      filename: item.filename,
      startFrame,
      durationFrames,
      isVideo: item.isVideo,
      kenBurns: item.kenBurns,
    });
  });
  return out;
}

function clipItem(c: PlacedClip, indent: string): string {
  const end = c.startFrame + c.durationFrames;
  let x = `${indent}<clipitem id="${c.id}">\n`;
  x += `${indent}  <name>${escapeXml(c.filename)}</name>\n`;
  x += `${indent}  <duration>${c.durationFrames}</duration>\n`;
  x += `${indent}  <rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>\n`;
  x += `${indent}  <start>${c.startFrame}</start>\n`;
  x += `${indent}  <end>${end}</end>\n`;
  x += `${indent}  <in>0</in>\n`;
  x += `${indent}  <out>${c.durationFrames}</out>\n`;
  x += fileBlock({
    fileId: c.fileId,
    filename: c.filename,
    durationFrames: c.durationFrames,
    isVideo: c.isVideo,
    indent: `${indent}  `,
  });
  if (c.kenBurns) {
    x += kenBurnsFilter({ kenBurns: c.kenBurns } as ProTimelineClip, c.durationFrames, `${indent}  `);
  }
  x += `${indent}</clipitem>\n`;
  return x;
}

export function buildProFcpxml(params: {
  title: string;
  timeline: ProTimeline;
  audioFilename?: string | null;
  audioDurationSec: number;
  audioVolume?: number;
}): string {
  const { title, timeline, audioFilename, audioDurationSec } = params;

  const brollClips = place(
    timeline.broll.map((c) => ({
      startSec: c.startSec,
      durationSec: c.durationSec,
      filename: c.filename,
      isVideo: c.isVideo,
      kenBurns: c.kenBurns,
    })),
    "b"
  );
  const overlayClips = place(
    timeline.overlays.map((o: ProOverlayClip) => ({
      startSec: o.startSec,
      durationSec: o.durationSec,
      filename: o.filename,
      isVideo: false,
    })),
    "o"
  );

  const totalFrames = Math.round(
    Math.max(audioDurationSec, timeline.totalDurationSec) * FPS
  );

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<!DOCTYPE xmeml>\n`;
  xml += `<xmeml version="5">\n`;
  xml += `  <project>\n`;
  xml += `    <name>${escapeXml(title)}</name>\n`;
  xml += `    <children>\n`;
  xml += `      <sequence>\n`;
  xml += `        <name>Pro Timeline</name>\n`;
  xml += `        <duration>${totalFrames}</duration>\n`;
  xml += `        <rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>\n`;
  xml += `        <media>\n`;
  xml += `          <video>\n`;
  xml += `            <format>\n`;
  xml += `              <samplecharacteristics>\n`;
  xml += `                <rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>\n`;
  xml += `                <width>${WIDTH}</width>\n`;
  xml += `                <height>${HEIGHT}</height>\n`;
  xml += `                <pixelaspectratio>square</pixelaspectratio>\n`;
  xml += `              </samplecharacteristics>\n`;
  xml += `            </format>\n`;

  // Track 1 — B-roll.
  xml += `            <track>\n`;
  for (const c of brollClips) xml += clipItem(c, "              ");
  xml += `            </track>\n`;

  // Track 2 — transparent overlays above the B-roll.
  xml += `            <track>\n`;
  for (const c of overlayClips) xml += clipItem(c, "              ");
  xml += `            </track>\n`;

  xml += `          </video>\n`;

  xml += `          <audio>\n`;
  xml += `            <format>\n`;
  xml += `              <samplecharacteristics><depth>16</depth><samplerate>44100</samplerate></samplecharacteristics>\n`;
  xml += `            </format>\n`;
  xml += `            <track>\n`;
  if (audioFilename) {
    const audioFrames = Math.round(audioDurationSec * FPS) || totalFrames;
    xml += `              <clipitem id="audio_1">\n`;
    xml += `                <name>${escapeXml(audioFilename)}</name>\n`;
    xml += `                <duration>${audioFrames}</duration>\n`;
    xml += `                <rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>\n`;
    xml += `                <start>0</start>\n`;
    xml += `                <end>${audioFrames}</end>\n`;
    xml += `                <in>0</in>\n`;
    xml += `                <out>${audioFrames}</out>\n`;
    xml += `                <file id="file_audio">\n`;
    xml += `                  <name>${escapeXml(audioFilename)}</name>\n`;
    xml += `                  <pathurl>file://localhost/./${escapeXml(audioFilename)}</pathurl>\n`;
    xml += `                  <rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>\n`;
    xml += `                  <media><audio><samplecharacteristics><samplerate>44100</samplerate></samplecharacteristics></audio></media>\n`;
    xml += `                </file>\n`;
    xml += `                <sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>\n`;
    xml += `              </clipitem>\n`;
  }
  xml += `            </track>\n`;
  xml += `          </audio>\n`;

  xml += `        </media>\n`;
  xml += `      </sequence>\n`;
  xml += `    </children>\n`;
  xml += `  </project>\n`;
  xml += `</xmeml>\n`;
  return xml;
}
