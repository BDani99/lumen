/**
 * Segments SRT data into scenes based on sentence count or time.
 */
export function segmentSrtIntoScenes(srtText: string, sentencesPerScene: number = 2) {
  // A very basic SRT parser and segmenter.
  // In a real app, use a robust library like 'srt-parser-2'
  // Normalize CRLF/CR to LF first — some SRT sources (incl. AI33) emit \r\n.
  const normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.trim().split(/\n\n+/);
  const scenes = [];

  let currentScene = { start_time: 0, end_time: 0, text: '' };
  let sentenceCount = 0;

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length >= 3) {
      const timecode = lines[1];
      const text = lines.slice(2).join(' ');
      
      // Parse timecode like "00:00:01,000 --> 00:00:03,500"
      const [startStr, endStr] = timecode.split(' --> ');
      const start = parseTime(startStr);
      const end = parseTime(endStr);
      
      if (currentScene.text === '') {
        currentScene.start_time = start;
      }
      
      currentScene.text += ' ' + text;
      currentScene.end_time = end;
      
      // Simple sentence counting based on punctuation
      const sentencesInBlock = (text.match(/[.!?]+(?:\s|$)/g) || []).length;
      sentenceCount += sentencesInBlock;
      
      const duration = currentScene.end_time - currentScene.start_time;
      // Vágás ha elérte a mondatszámot, VAGY ha túl hosszú lett a jelenet (pl. nincs írásjel 15 másodpercen át)
      if (sentenceCount >= sentencesPerScene || duration > (sentencesPerScene * 5)) {
        scenes.push({ ...currentScene });
        currentScene = { start_time: 0, end_time: 0, text: '' };
        sentenceCount = 0;
      }
    }
  }
  
  if (currentScene.text !== '') {
    scenes.push({ ...currentScene });
  }
  
  return scenes;
}

function parseTime(timeStr: string): number {
  const [hours, minutes, secondsAndMs] = timeStr.split(':');
  const [seconds, ms] = secondsAndMs.split(',');
  return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds) + parseInt(ms) / 1000;
}
