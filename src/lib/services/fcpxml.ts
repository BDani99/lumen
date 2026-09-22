/**
 * Generates an FCP7 XML format for DaVinci Resolve based on timeline data.
 */
export function generateFcpXml(scenes: any[], fps: number = 24, resolution = { width: 1920, height: 1080 }) {
  const formatId = `r${fps}`;
  
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<!DOCTYPE xmeml>\n`;
  xml += `<xmeml version="5.0">\n`;
  xml += `  <sequence id="sequence-1">\n`;
  xml += `    <name>Generated Video</name>\n`;
  xml += `    <duration>${Math.round(scenes[scenes.length - 1]?.end_time * fps || 0)}</duration>\n`;
  xml += `    <rate>\n`;
  xml += `      <timebase>${fps}</timebase>\n`;
  xml += `      <ntsc>FALSE</ntsc>\n`;
  xml += `    </rate>\n`;
  xml += `    <media>\n`;
  xml += `      <video>\n`;
  xml += `        <format>\n`;
  xml += `          <samplecharacteristics>\n`;
  xml += `            <width>${resolution.width}</width>\n`;
  xml += `            <height>${resolution.height}</height>\n`;
  xml += `          </samplecharacteristics>\n`;
  xml += `        </format>\n`;
  xml += `        <track>\n`;
  
  // Add Video Clips (Images)
  let currentFrame = 0;
  scenes.forEach((scene, index) => {
    const durationFrames = Math.round((scene.end_time - scene.start_time) * fps);
    const startFrame = currentFrame;
    const endFrame = startFrame + durationFrames;
    currentFrame = endFrame;

    xml += `          <clipitem id="clip-${index}">\n`;
    xml += `            <name>Scene ${index + 1}</name>\n`;
    xml += `            <duration>${durationFrames}</duration>\n`;
    xml += `            <start>${startFrame}</start>\n`;
    xml += `            <end>${endFrame}</end>\n`;
    xml += `            <file id="file-${index}">\n`;
    xml += `              <name>image_${index}.jpg</name>\n`;
    xml += `              <pathurl>file://localhost/images/image_${index}.jpg</pathurl>\n`;
    xml += `            </file>\n`;
    
    // Ken Burns Effect implementation using filter (basic scale & center mapping)
    xml += `            <filter>\n`;
    xml += `              <effect>\n`;
    xml += `                <name>Basic Motion</name>\n`;
    xml += `                <effectid>basic</effectid>\n`;
    xml += `                <effectcategory>motion</effectcategory>\n`;
    xml += `                <effecttype>motion</effecttype>\n`;
    xml += `                <parameter>\n`;
    xml += `                  <parameterid>scale</parameterid>\n`;
    xml += `                  <name>Scale</name>\n`;
    xml += `                  <keyframe>\n`;
    xml += `                    <when>0</when>\n`;
    xml += `                    <value>100</value>\n`;
    xml += `                  </keyframe>\n`;
    xml += `                  <keyframe>\n`;
    xml += `                    <when>${durationFrames}</when>\n`;
    xml += `                    <value>110</value>\n`;
    xml += `                  </keyframe>\n`;
    xml += `                </parameter>\n`;
    xml += `              </effect>\n`;
    xml += `            </filter>\n`;

    xml += `          </clipitem>\n`;
  });

  xml += `        </track>\n`;
  xml += `      </video>\n`;
  
  // Add Audio Track
  xml += `      <audio>\n`;
  xml += `        <format>\n`;
  xml += `          <samplecharacteristics>\n`;
  xml += `            <depth>16</depth>\n`;
  xml += `            <samplerate>44100</samplerate>\n`;
  xml += `          </samplecharacteristics>\n`;
  xml += `        </format>\n`;
  xml += `        <track>\n`;
  xml += `          <clipitem id="audio-1">\n`;
  xml += `            <name>Voiceover</name>\n`;
  xml += `            <duration>${currentFrame}</duration>\n`;
  xml += `            <start>0</start>\n`;
  xml += `            <end>${currentFrame}</end>\n`;
  xml += `            <file id="audio-file">\n`;
  xml += `              <name>voiceover.mp3</name>\n`;
  xml += `              <pathurl>file://localhost/audio/voiceover.mp3</pathurl>\n`;
  xml += `            </file>\n`;
  xml += `          </clipitem>\n`;
  xml += `        </track>\n`;
  xml += `      </audio>\n`;

  xml += `    </media>\n`;
  xml += `  </sequence>\n`;
  xml += `</xmeml>\n`;

  return xml;
}
