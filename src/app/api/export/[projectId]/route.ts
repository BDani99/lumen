import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  buildVisualTimeline,
  type MotionClipsByScene,
} from "@/lib/motion-clips";
import {
  assertProjectOwned,
  forbidden,
  requireUserApi,
} from "@/lib/auth";

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const { projectId } = await params;
    if (!(await assertProjectOwned(projectId, auth.user.id))) {
      return forbidden("Project not found or not owned");
    }

    const { data: project, error } = await supabaseAdmin
      .from("video_projects")
      .select("*, video_scenes(*), channels(*)")
      .eq("id", projectId)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const scenes = project.video_scenes.sort((a: any, b: any) => a.scene_order - b.scene_order);
    const fps = 30;
    const wanClipSec =
      Number(project.timeline_data?.generationOptions?.videoDurationSec) || 5;
    const motionClipsByScene = (project.timeline_data?.motionClipsByScene ||
      {}) as MotionClipsByScene;

    // Construct FCPXML
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<!DOCTYPE xmeml>\n`;
    xml += `<xmeml version="5">\n`;
    xml += `  <project>\n`;
    xml += `    <name>${project.title}</name>\n`;
    xml += `    <children>\n`;
    xml += `      <sequence>\n`;
    xml += `        <name>Timeline 1</name>\n`;
    xml += `        <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>\n`;
    xml += `        <media>\n`;
    xml += `          <video>\n`;
    xml += `            <format>\n`;
    xml += `              <samplecharacteristics>\n`;
    xml += `                <width>1920</width>\n`;
    xml += `                <height>1080</height>\n`;
    xml += `              </samplecharacteristics>\n`;
    xml += `            </format>\n`;
    xml += `            <track>\n`;

    let imagesToDownload: any[] = [];
    let videosToDownload: any[] = [];

    const zoomLevel = project.channels?.auto_zoom_level || 115;

    const appendClip = (opts: {
      id: string;
      fileId: string;
      filename: string;
      startFrame: number;
      durationFrames: number;
      effect?: string;
      applyEffect: boolean;
      isVideo: boolean;
    }) => {
      const { id, fileId, filename, startFrame, durationFrames, effect, applyEffect, isVideo } = opts;
      const endFrame = startFrame + durationFrames;
      let chunk = `              <clipitem id="${id}">\n`;
      chunk += `                <name>${filename}</name>\n`;
      chunk += `                <duration>${durationFrames}</duration>\n`;
      chunk += `                <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>\n`;
      chunk += `                <start>${startFrame}</start>\n`;
      chunk += `                <end>${endFrame}</end>\n`;
      chunk += `                <in>0</in>\n`;
      chunk += `                <out>${durationFrames}</out>\n`;
      chunk += `                <file id="${fileId}">\n`;
      chunk += `                  <name>${filename}</name>\n`;
      chunk += `                  <pathurl>file://localhost/./${filename}</pathurl>\n`;
      if (isVideo) {
        chunk += `                  <duration>${durationFrames}</duration>\n`;
      }
      chunk += `                  <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>\n`;
      chunk += `                  <timecode><rate><timebase>${fps}</timebase></rate><string>00:00:00:00</string><frame>0</frame></timecode>\n`;
      chunk += `                  <media>\n`;
      if (isVideo) {
        chunk += `                    <video>\n`;
        chunk += `                      <duration>${durationFrames}</duration>\n`;
        chunk += `                      <samplecharacteristics>\n`;
        chunk += `                        <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>\n`;
        chunk += `                        <width>1920</width>\n`;
        chunk += `                        <height>1080</height>\n`;
        chunk += `                        <pixelaspectratio>square</pixelaspectratio>\n`;
        chunk += `                        <fielddominance>none</fielddominance>\n`;
        chunk += `                        <colordepth>24</colordepth>\n`;
        chunk += `                      </samplecharacteristics>\n`;
        chunk += `                    </video>\n`;
      } else {
        chunk += `                    <video><duration>${durationFrames}</duration><samplecharacteristics><width>1920</width><height>1080</height></samplecharacteristics></video>\n`;
      }
      chunk += `                  </media>\n`;
      chunk += `                </file>\n`;
      if (applyEffect && effect && effect !== "Nincs effekt" && effect !== "") {
        let scaleParam = `<parameter><parameterid>scale</parameterid><name>Scale</name><valuemin>0</valuemin><valuemax>10000</valuemax><value>100</value></parameter>`;
        let centerParam = `<parameter><parameterid>center</parameterid><name>Center</name><value><horiz>0</horiz><vert>0</vert></value></parameter>`;
        if (effect === "Zoom In") {
          scaleParam = `<parameter><parameterid>scale</parameterid><name>Scale</name><valuemin>0</valuemin><valuemax>10000</valuemax><value>100</value><keyframe><when>0</when><value>100</value></keyframe><keyframe><when>${durationFrames}</when><value>${zoomLevel}</value></keyframe></parameter>`;
        } else if (effect === "Zoom Out") {
          scaleParam = `<parameter><parameterid>scale</parameterid><name>Scale</name><valuemin>0</valuemin><valuemax>10000</valuemax><value>${zoomLevel}</value><keyframe><when>0</when><value>${zoomLevel}</value></keyframe><keyframe><when>${durationFrames}</when><value>100</value></keyframe></parameter>`;
        } else if (effect === "Pan Left") {
          scaleParam = `<parameter><parameterid>scale</parameterid><name>Scale</name><valuemin>0</valuemin><valuemax>10000</valuemax><value>${zoomLevel}</value></parameter>`;
          centerParam = `<parameter><parameterid>center</parameterid><name>Center</name><value><horiz>0</horiz><vert>0</vert></value><keyframe><when>0</when><value><horiz>-0.05</horiz><vert>0</vert></value></keyframe><keyframe><when>${durationFrames}</when><value><horiz>0.05</horiz><vert>0</vert></value></keyframe></parameter>`;
        } else if (effect === "Pan Right") {
          scaleParam = `<parameter><parameterid>scale</parameterid><name>Scale</name><valuemin>0</valuemin><valuemax>10000</valuemax><value>${zoomLevel}</value></parameter>`;
          centerParam = `<parameter><parameterid>center</parameterid><name>Center</name><value><horiz>0</horiz><vert>0</vert></value><keyframe><when>0</when><value><horiz>0.05</horiz><vert>0</vert></value></keyframe><keyframe><when>${durationFrames}</when><value><horiz>-0.05</horiz><vert>0</vert></value></keyframe></parameter>`;
        }
        chunk += `                <filter>\n`;
        chunk += `                  <effect>\n`;
        chunk += `                    <name>Basic Motion</name>\n`;
        chunk += `                    <effectid>basic</effectid>\n`;
        chunk += `                    <effectcategory>motion</effectcategory>\n`;
        chunk += `                    <effecttype>motion</effecttype>\n`;
        chunk += `                    <mediatype>video</mediatype>\n`;
        chunk += `                    ${scaleParam}\n`;
        chunk += `                    ${centerParam}\n`;
        chunk += `                  </effect>\n`;
        chunk += `                </filter>\n`;
      }
      chunk += `              </clipitem>\n`;
      return chunk;
    };

    // Strictly sequential visual timeline: a scene's video/image always plays its
    // full length; overruns push later scenes' content back instead of the two
    // overlapping in the FCPXML or the overflow being silently dropped. See
    // buildVisualTimeline for the full contract.
    const channelForTimeline = Array.isArray(project.channels)
      ? project.channels[0]
      : (project as any).channels;
    const locationShotSec = Number(channelForTimeline?.location_shot_sec) || 3;
    const timeline = buildVisualTimeline(
      scenes,
      motionClipsByScene,
      wanClipSec,
      undefined,
      locationShotSec
    );
    const skippedScenes = timeline.skippedScenes;

    for (let idx = 0; idx < timeline.segments.length; idx++) {
      const seg = timeline.segments[idx];
      const startFrame = Math.round(seg.startSec * fps);
      const endFrame = Math.round((seg.startSec + seg.durationSec) * fps);
      const durationFrames = endFrame - startFrame;
      if (durationFrames <= 0) continue;

      const sceneNum = seg.sceneIndex + 1;
      if (seg.kind === "video") {
        const filename =
          seg.clipCount && seg.clipCount > 1
            ? `scene_${sceneNum}_c${(seg.clipIndex ?? 0) + 1}.mp4`
            : `scene_${sceneNum}.mp4`;
        videosToDownload.push({ name: filename, url: seg.url });
        xml += appendClip({
          id: `seg_${idx}_v`,
          fileId: `file_${idx}_v`,
          filename,
          startFrame,
          durationFrames,
          effect: seg.effect || undefined,
          applyEffect: false,
          isVideo: true,
        });
      } else {
        // A scene can contribute two stills (its establishing shot and its own
        // image); they must not collide on the same filename in the zip.
        //
        // Filenames must NOT share an identical prefix+suffix around an
        // ascending number — DaVinci Resolve auto-detects such runs as a
        // single-frame image sequence and silently stacks them into one
        // "Media Offline" clip on import. A trailing "_img"/"_location" tag
        // alone does not defeat this: Resolve's detector matches on the text
        // immediately around the LAST digit run, and "scene_5_img.png" vs
        // "scene_6_img.png" still share that identical surrounding text. The
        // scene's own (non-sequential) database id, placed right after the
        // shared "scene_" prefix, makes every filename's prefix genuinely
        // distinct, so no run of files can ever match as a sequence.
        // Kept short on purpose — long zip paths plus a deep extraction
        // folder can trip Windows' MAX_PATH limit (0x80010135, "Az elérési
        // út túl hosszú") during unzip.
        const sceneId = String((timeline.sortedScenes[seg.sceneIndex] as any)?.id || idx);
        const sceneTag = sceneId.replace(/-/g, "").slice(0, 6) || `x${idx}`;
        const filename = seg.isLocationShot
          ? `l${sceneTag}_${sceneNum}.png`
          : `i${sceneTag}_${sceneNum}.png`;
        imagesToDownload.push({ name: filename, url: seg.url });
        xml += appendClip({
          id: `seg_${idx}_i`,
          fileId: `file_${idx}_i`,
          filename,
          startFrame,
          durationFrames,
          effect: seg.effect || undefined,
          applyEffect: true,
          isVideo: false,
        });
      }
    }

    xml += `            </track>\n`;
    xml += `          </video>\n`;
    
    // Audio track
    xml += `          <audio>\n`;
    xml += `            <format>\n`;
    xml += `              <samplecharacteristics>\n`;
    xml += `                <depth>16</depth>\n`;
    xml += `                <samplerate>44100</samplerate>\n`;
    xml += `              </samplecharacteristics>\n`;
    xml += `            </format>\n`;
    xml += `            <track>\n`;
    if (project.timeline_data?.audio_url) {
      const audioNaturalEndSec = Number(scenes[scenes.length - 1]?.end_time) || 0;
      const durationFrames = Math.round(
        Math.max(audioNaturalEndSec, timeline.totalDurationSec) * fps
      );
      xml += `              <clipitem id="audio_1">\n`;
      xml += `                <name>voiceover.mp3</name>\n`;
      xml += `                <duration>${durationFrames}</duration>\n`;
      xml += `                <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>\n`;
      xml += `                <start>0</start>\n`;
      xml += `                <end>${durationFrames}</end>\n`;
      xml += `                <in>0</in>\n`;
      xml += `                <out>${durationFrames}</out>\n`;
      xml += `                <file id="file_audio">\n`;
      xml += `                  <name>voiceover.mp3</name>\n`;
      xml += `                  <pathurl>file://localhost/./voiceover.mp3</pathurl>\n`;
      xml += `                  <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>\n`;
      xml += `                  <media><audio><samplecharacteristics><samplerate>44100</samplerate></samplecharacteristics></audio></media>\n`;
      xml += `                </file>\n`;
      xml += `                <sourcetrack>\n`;
      xml += `                  <mediatype>audio</mediatype>\n`;
      xml += `                  <trackindex>1</trackindex>\n`;
      xml += `                </sourcetrack>\n`;
      xml += `                <filter>
                  <effect>
                    <name>Audio Levels</name>
                    <effectid>audiolevels</effectid>
                    <effectcategory>audiocontrol</effectcategory>
                    <effecttype>audiocontrol</effecttype>
                    <mediatype>audio</mediatype>
                    <parameter>
                      <parameterid>level</parameterid>
                      <name>Level</name>
                      <valuemin>0</valuemin>
                      <valuemax>10</valuemax>
                      <value>${(project.channels?.audio_volume ?? 100) / 100}</value>
                    </parameter>
                  </effect>
                </filter>
              </clipitem>\n`;
    }
    xml += `            </track>\n`;
    xml += `          </audio>\n`;

    xml += `        </media>\n`;
    xml += `      </sequence>\n`;
    xml += `    </children>\n`;
    xml += `  </project>\n`;
    xml += `</xmeml>\n`;

    // Generate download scripts ONLY if there are videos to download
    let scripts = null;
    if (videosToDownload.length > 0) {
      let batScript = `@echo off\n`;
      let shScript = `#!/bin/bash\n`;
      
      videosToDownload.forEach(m => {
        batScript += `curl -L -o "${m.name}" "${m.url}"\n`;
        shScript += `curl -L -o "${m.name}" "${m.url}"\n`;
      });
      batScript += `echo Letoltes kesz!\npause`;
      shScript += `echo "Letoltes kesz!"`;
      scripts = { bat: batScript, sh: shScript };
    }

    return NextResponse.json({
      fcpxml: xml,
      audioUrl: project.timeline_data?.audio_url || null,
      images: imagesToDownload,
      videos: videosToDownload,
      srtData: project.srt_data || "",
      scripts: scripts,
      title: project.title || "",
      script: project.generated_script || project.script || "",
      thumbnailUrl: project.thumbnail_url || "",
      skippedScenes,
    });

  } catch (e: any) {
    console.error("[api/export]", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
