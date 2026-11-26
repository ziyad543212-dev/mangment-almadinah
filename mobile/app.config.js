module.exports = {
  expo: {
    name: 'المدينة للحج والعمرة', slug: 'almadinah-mobile', version: '1.3.0',
    icon: './assets/icon.png',
    orientation: 'default',
    android: {
      package: 'com.almadinah.management.mobile', versionCode: 4, allowBackup: false,
      softwareKeyboardLayoutMode: 'resize',
      adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#1a1a2e' },
      permissions: ['android.permission.CAMERA'],
      usesCleartextTraffic: true
    },
    plugins: ['expo-sharing', 'expo-status-bar', './plugins/with-android-config'],
    extra: { appUrl: process.env.EXPO_PUBLIC_APP_URL || '' }
  }
};
