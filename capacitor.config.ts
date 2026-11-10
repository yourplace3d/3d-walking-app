import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.yourplace3d.walkit3d',
  appName: 'Walk it 3D',
  webDir: 'dist',
  ios: {
    // the app paints its own parchment behind the safe areas
    contentInset: 'never',
    backgroundColor: '#efe6d2',
  },
};

export default config;
