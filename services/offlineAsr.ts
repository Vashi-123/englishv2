import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';

type OfflineAsrIsAvailableResult = { available: boolean; reason?: string };
type OfflineAsrStopResult = { transcript: string; acceptedSamplesTotal?: number; peakAbs?: number; rms?: number };

export interface OfflineAsrPlugin {
  isAvailable(): Promise<OfflineAsrIsAvailableResult>;
  start(options?: { lang?: string; expectedText?: string }): Promise<{ started: boolean; reason?: string }>;
  stop(): Promise<OfflineAsrStopResult>;
  cancel(): Promise<void>;
}

const OfflineAsr = registerPlugin<OfflineAsrPlugin>('OfflineAsr');

export async function isOfflineAsrUsable(): Promise<boolean> {
  console.log('[OfflineASR-JS] isOfflineAsrUsable called');
  console.log('[OfflineASR-JS] isNativePlatform:', Capacitor.isNativePlatform());
  console.log('[OfflineASR-JS] platform:', Capacitor.getPlatform());
  
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
    console.log('[OfflineASR-JS] Not iOS native, returning false');
    return false;
  }
  
  try {
    console.log('[OfflineASR-JS] Calling OfflineAsr.isAvailable()...');
    const res = await OfflineAsr.isAvailable();
    console.log('[OfflineASR-JS] isAvailable result:', res);
    return Boolean(res?.available);
  } catch (err) {
    console.error('[OfflineASR-JS] isAvailable error:', err);
    return false;
  }
}

export async function offlineAsrStart(expectedText?: string): Promise<boolean> {
  try {
    const res = await OfflineAsr.start({ lang: 'en-US', expectedText });
    if (!res?.started) {
      // eslint-disable-next-line no-console
      console.warn('[OfflineASR] start failed:', { reason: res?.reason || null });
    }
    return Boolean(res?.started);
  } catch {
    return false;
  }
}

export async function offlineAsrStopWithStats(): Promise<OfflineAsrStopResult> {
  try {
    const res = await OfflineAsr.stop();
    // eslint-disable-next-line no-console
    console.log('[OfflineASR] stop result:', {
      transcriptLen: String(res?.transcript || '').length,
      acceptedSamplesTotal: typeof res?.acceptedSamplesTotal === 'number' ? res.acceptedSamplesTotal : undefined,
      peakAbs: typeof res?.peakAbs === 'number' ? res.peakAbs : undefined,
      rms: typeof res?.rms === 'number' ? res.rms : undefined,
    });
    return {
      transcript: String(res?.transcript || ''),
      acceptedSamplesTotal: typeof res?.acceptedSamplesTotal === 'number' ? res.acceptedSamplesTotal : undefined,
      peakAbs: typeof res?.peakAbs === 'number' ? res.peakAbs : undefined,
      rms: typeof res?.rms === 'number' ? res.rms : undefined,
    };
  } catch {
    return { transcript: '' };
  }
}

export async function offlineAsrStop(): Promise<string> {
  try {
    const res = await offlineAsrStopWithStats();
    return String(res?.transcript || '');
  } catch {
    return '';
  }
}

export async function offlineAsrCancel(): Promise<void> {
  try {
    await OfflineAsr.cancel();
  } catch {
    // ignore
  }
}
