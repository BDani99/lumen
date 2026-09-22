"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import Link from "next/link";
import VoiceSettingsPanel from "./VoiceSettingsPanel";
import { Button, Input, Label } from "@/components/ui";
import { useChannelFormState } from "./hooks/useChannelFormState";
import { useVideoDefaultsState } from "./hooks/useVideoDefaultsState";
import { useNamePoolPresets } from "./hooks/useNamePoolPresets";
import { useVoiceSettingsState } from "./hooks/useVoiceSettingsState";
import { TextModelSection } from "./TextModelSection";
import { ImageGenerationSection } from "./ImageGenerationSection";
import { VideoDefaultsSection } from "./VideoDefaultsSection";
import { NamePoolSection } from "./NamePoolSection";
import { MasterPromptSection } from "./MasterPromptSection";

export default function ChannelForm({
  initialChannel,
  userId,
}: {
  initialChannel: any;
  userId: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const isNew = !initialChannel;

  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useChannelFormState(initialChannel);
  const videoDefaults = useVideoDefaultsState(initialChannel);
  const { namePoolPresets, selectedNamePoolPreset } = useNamePoolPresets(form.namePoolPresetId);
  const { voiceSettings, setVoiceSettings } = useVoiceSettingsState(initialChannel);

  const handleSave = async () => {
    setFormError(null);
    if (!form.name.trim()) {
      setFormError("Add meg a csatorna nevét.");
      return;
    }
    if (!voiceSettings.voiceId.trim()) {
      setFormError("Válassz ki egy hangot (Voice ID) a hangbeállításoknál.");
      return;
    }

    setLoading(true);

    const channelData = form.buildChannelData({
      voiceSettings,
      videoGenerationDefaults: videoDefaults.buildVideoGenerationDefaults(),
    });

    if (isNew) {
      const { error } = await supabase.from("channels").insert([{ ...channelData, user_id: userId }]);
      if (!error) router.push("/channels");
      else setFormError(error.message);
    } else {
      const { error } = await supabase.from("channels").update(channelData).eq("id", initialChannel.id);
      if (!error) router.push("/channels");
      else setFormError(error.message);
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      {formError && (
        <p className="rounded-[var(--radius)] border border-danger/30 bg-danger-muted px-4 py-3 text-sm text-ink">{formError}</p>
      )}
      <div className="flex items-center space-x-4 mb-8">
        <Link href="/channels" className="text-muted hover:text-ink transition-colors">&larr; Vissza</Link>
        <h1 className="font-display text-3xl tracking-tight text-ink">{isNew ? "Új Csatorna" : "Csatorna Szerkesztése"}</h1>
      </div>

      <div className="space-y-6 border-t border-border pt-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <Label>Csatorna Neve</Label>
            <Input type="text" value={form.name} onChange={(e) => form.setName(e.target.value)} />
          </div>
          <div>
            <Label>Nyelv</Label>
            <Input type="text" value={form.language} onChange={(e) => form.setLanguage(e.target.value)} />
          </div>
        </div>

        <TextModelSection
          textModel={form.textModel}
          setTextModel={form.setTextModel}
          polishModel={form.polishModel}
          setPolishModel={form.setPolishModel}
        />

        <ImageGenerationSection
          imageModel={form.imageModel}
          setImageModel={form.setImageModel}
          sentencesPerImage={form.sentencesPerImage}
          setSentencesPerImage={form.setSentencesPerImage}
          useStockVideo={form.useStockVideo}
          setUseStockVideo={form.setUseStockVideo}
          stockSettings={form.stockSettings}
          setStockSettings={form.setStockSettings}
          useLocationShots={form.useLocationShots}
          setUseLocationShots={form.setUseLocationShots}
          locationShotSec={form.locationShotSec}
          setLocationShotSec={form.setLocationShotSec}
          autoZoomEffect={form.autoZoomEffect}
          setAutoZoomEffect={form.setAutoZoomEffect}
          autoZoomLevel={form.autoZoomLevel}
          setAutoZoomLevel={form.setAutoZoomLevel}
          audioVolume={form.audioVolume}
          setAudioVolume={form.setAudioVolume}
          imageStyle={form.imageStyle}
          setImageStyle={form.setImageStyle}
          imagePromptBase={form.imagePromptBase}
          setImagePromptBase={form.setImagePromptBase}
          thumbnailPrompt={form.thumbnailPrompt}
          setThumbnailPrompt={form.setThumbnailPrompt}
          autoGenerateThumbnail={form.autoGenerateThumbnail}
          setAutoGenerateThumbnail={form.setAutoGenerateThumbnail}
          useCharacterGlossaryForThumbnails={form.useCharacterGlossaryForThumbnails}
          setUseCharacterGlossaryForThumbnails={form.setUseCharacterGlossaryForThumbnails}
        />

        <VideoDefaultsSection
          defaultMediaMode={videoDefaults.defaultMediaMode}
          setDefaultMediaMode={videoDefaults.setDefaultMediaMode}
          defaultVideoModel={videoDefaults.defaultVideoModel}
          setDefaultVideoModel={videoDefaults.setDefaultVideoModel}
          defaultVideoStrategy={videoDefaults.defaultVideoStrategy}
          setDefaultVideoStrategy={videoDefaults.setDefaultVideoStrategy}
          defaultVideoPattern={videoDefaults.defaultVideoPattern}
          setDefaultVideoPattern={videoDefaults.setDefaultVideoPattern}
          defaultVideoEveryN={videoDefaults.defaultVideoEveryN}
          setDefaultVideoEveryN={videoDefaults.setDefaultVideoEveryN}
          defaultVideoFirstSeconds={videoDefaults.defaultVideoFirstSeconds}
          setDefaultVideoFirstSeconds={videoDefaults.setDefaultVideoFirstSeconds}
          defaultIntroVideoCount={videoDefaults.defaultIntroVideoCount}
          setDefaultIntroVideoCount={videoDefaults.setDefaultIntroVideoCount}
          defaultVideoDurationSec={videoDefaults.defaultVideoDurationSec}
          setDefaultVideoDurationSec={videoDefaults.setDefaultVideoDurationSec}
          defaultVideoResolution={videoDefaults.defaultVideoResolution}
          setDefaultVideoResolution={videoDefaults.setDefaultVideoResolution}
          defaultMaxVideoScenes={videoDefaults.defaultMaxVideoScenes}
          setDefaultMaxVideoScenes={videoDefaults.setDefaultMaxVideoScenes}
          allowedResolutions={videoDefaults.allowedResolutions}
        />

        <NamePoolSection
          useNamePools={form.useNamePools}
          setUseNamePools={form.setUseNamePools}
          namePoolPresetId={form.namePoolPresetId}
          setNamePoolPresetId={form.setNamePoolPresetId}
          namePoolPresets={namePoolPresets}
          selectedNamePoolPreset={selectedNamePoolPreset}
        />

        <MasterPromptSection masterPrompt={form.masterPrompt} setMasterPrompt={form.setMasterPrompt} />

        <VoiceSettingsPanel value={voiceSettings} onChange={setVoiceSettings} />

        <div className="flex justify-end space-x-4 pt-6">
          <Button onClick={handleSave} disabled={loading} className="!px-6 !py-3">
            {loading ? "Mentés..." : "Csatorna Mentése"}
          </Button>
        </div>
      </div>
    </div>
  );
}
