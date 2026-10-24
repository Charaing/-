import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.boxingvoicecoach.app',
  appName: 'BOXING',
  webDir: 'dist',
  backgroundColor: '#080A0D',
  ios: {
    contentInset: 'never',
    backgroundColor: '#080A0D',
    scrollEnabled: true,
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
