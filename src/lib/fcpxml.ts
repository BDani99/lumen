export function generateFCPXML(projectName: string, audioUrl: string, scenes: { image_url: string; start_time: number; end_time: number }[]) {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat1080p30" frameDuration="100/3000s" width="1920" height="1080" />
    <asset id="audio1" name="voiceover.mp3" src="./voiceover.mp3" />
`;

  scenes.forEach((scene, i) => {
    xml += `    <asset id="img${i}" name="scene_${i}.jpg" src="./scene_${i}.jpg" />\n`;
  });

  xml += `  </resources>
  <library>
    <event name="${projectName} Event">
      <project name="${projectName}">
        <sequence format="r1">
          <spine>
            <gap name="Gap" offset="0s" duration="3600s" start="0s">
              <audio ref="audio1" offset="0s" />
`;

  scenes.forEach((scene, i) => {
    const startSec = (scene.start_time / 1000).toFixed(3);
    const durationSec = ((scene.end_time - scene.start_time) / 1000).toFixed(3);
    // We place images as connected clips (titles/video) over the gap.
    xml += `              <video ref="img${i}" offset="${startSec}s" duration="${durationSec}s" start="0s" lane="1" />\n`;
  });

  xml += `            </gap>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;

  return xml;
}
