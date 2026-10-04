import { describe, expect, it } from 'vitest';

import appConfig from '../../app.json';
import { colors } from './theme';

describe('SautiForge brand colors', () => {
  it('uses the green brand palette for the splash, adaptive icon, and interface', () => {
    const splash = appConfig.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen');
    const splashOptions = Array.isArray(splash) && typeof splash[1] === 'object' ? splash[1] : null;
    expect(splashOptions?.backgroundColor).toBe(colors.primary);
    expect(appConfig.expo.android.adaptiveIcon.backgroundColor).toBe(colors.primarySoft);
  });
});
