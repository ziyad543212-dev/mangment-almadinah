const { withAndroidManifest, withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

module.exports = function withAndroidConfig(config) {
  config = withGradleProperties(config, (result) => {
    const properties = { 'android.cmakeVersion': '3.30.5', 'org.gradle.workers.max': '2',
      'org.gradle.jvmargs': '-Xmx2048m -XX:MaxMetaspaceSize=1024m',
      'kotlin.compiler.execution.strategy': 'in-process' };
    for (const [key, value] of Object.entries(properties)) {
      const existing = result.modResults.find((item) => item.type === 'property' && item.key === key);
      if (existing) existing.value = value;
      else result.modResults.push({ type: 'property', key, value });
    }
    return result;
  });
  config = withAndroidManifest(config, (result) => {
    result.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'true';
    return result;
  });
  return withAppBuildGradle(config, (result) => {
    const objectPathMarker = '// AlMadinah Windows native object paths';
    if (!result.modResults.contents.includes(objectPathMarker)) {
      result.modResults.contents += `
${objectPathMarker}
android.defaultConfig.externalNativeBuild.cmake.arguments '-DCMAKE_OBJECT_PATH_MAX=240'
`;
    }
    const marker = '// AlMadinah local release signing';
    if (!result.modResults.contents.includes(marker)) {
      result.modResults.contents += `
${marker}
if (System.getenv('ALMADINAH_KEYSTORE')) {
    android.signingConfigs.create('almadinahRelease') {
        storeFile file(System.getenv('ALMADINAH_KEYSTORE'))
        storePassword System.getenv('ALMADINAH_STORE_PASSWORD')
        keyAlias 'almadinah'
        keyPassword System.getenv('ALMADINAH_STORE_PASSWORD')
    }
    android.buildTypes.release.signingConfig = android.signingConfigs.almadinahRelease
}
`;
    }
    return result;
  });
};
