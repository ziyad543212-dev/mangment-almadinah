const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const nativeDir = path.join(root, 'android');
const windows = process.platform === 'win32';
const executable = (name) => name + (windows ? '.exe' : '');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true, ...options });
  if (result.error) throw new Error(`Could not start ${path.basename(command)}: ${result.error.code}`);
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed with exit code ${result.status}.`);
}

function main() {
  const urlArgument = process.argv.find((argument) => argument.startsWith('--app-url='));
  if (urlArgument) process.env.EXPO_PUBLIC_APP_URL = require('../src/server-url').normalizeAppUrl(urlArgument.slice('--app-url='.length));
  if (!process.env.EXPO_PUBLIC_APP_URL) throw new Error('Provide --app-url or EXPO_PUBLIC_APP_URL before building.');
  process.env.EXPO_PUBLIC_APP_URL = require('../src/server-url').normalizeAppUrl(process.env.EXPO_PUBLIC_APP_URL);
  const localTools = path.join(root, '.toolchain');
  const jdkCandidates = [process.env.JAVA_HOME, path.join(localTools, 'jdk'),
    windows && 'C:\\Program Files\\Android\\Android Studio\\jbr'].filter(Boolean);
  const jdkDir = jdkCandidates.find((candidate) => fs.existsSync(path.join(candidate, 'bin', executable('java'))));
  const java = jdkDir ? path.join(jdkDir, 'bin', executable('java')) : executable('java');
  const javaVersion = spawnSync(java, ['-version'], { encoding: 'utf8', windowsHide: true });
  if (javaVersion.error || javaVersion.status !== 0) throw new Error('JDK 21 is required to build the APK. Install a JDK or set JAVA_HOME.');
  if (jdkDir) {
    process.env.JAVA_HOME = jdkDir;
    process.env.PATH = path.join(jdkDir, 'bin') + path.delimiter + process.env.PATH;
  }
  const sdkCandidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(localTools, 'android-sdk'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')].filter(Boolean);
  const sdkDir = sdkCandidates.find((candidate) => fs.existsSync(candidate));
  if (!sdkDir) throw new Error('Android SDK is required to build the APK. Install its tools or set ANDROID_HOME.');
  process.env.ANDROID_HOME = sdkDir;
  process.env.ANDROID_SDK_ROOT = sdkDir;

  run(process.execPath, [path.join(root, 'scripts', 'bundle-ui.js')]);

  run(process.execPath, [path.join(root, 'node_modules', 'expo', 'bin', 'cli'), 'prebuild', '--platform', 'android', '--no-install']);
  const signingDir = path.join(root, '.signing');
  const credentialsPath = path.join(signingDir, 'credentials.json');
  const keystore = path.join(signingDir, 'almadinah-upload.jks');
  fs.mkdirSync(signingDir, { recursive: true });
  if (!fs.existsSync(credentialsPath)) {
    if (fs.existsSync(keystore)) throw new Error('Restore signing credentials for the existing key; it will not be replaced.');
    fs.writeFileSync(credentialsPath, JSON.stringify({ password: crypto.randomBytes(32).toString('base64') }), { mode: 0o600 });
  }
  process.env.ALMADINAH_STORE_PASSWORD = JSON.parse(fs.readFileSync(credentialsPath, 'utf8')).password;
  process.env.ALMADINAH_KEYSTORE = keystore;
  try {
    if (!fs.existsSync(keystore)) {
      run(jdkDir ? path.join(jdkDir, 'bin', executable('keytool')) : executable('keytool'), [
        '-genkeypair', '-keystore', keystore, '-alias', 'almadinah', '-keyalg', 'RSA', '-keysize', '2048',
        '-validity', '10000', '-storepass:env', 'ALMADINAH_STORE_PASSWORD', '-keypass:env', 'ALMADINAH_STORE_PASSWORD',
        '-dname', 'CN=AlMadinah Management, O=AlMadinah, C=SA', '-noprompt'
      ]);
    }
    run(java, ['-Dorg.gradle.appname=gradlew', '-jar', path.join(nativeDir, 'gradle', 'wrapper', 'gradle-wrapper.jar'),
      '-p', nativeDir, 'app:assembleRelease', '-Pkotlin.compiler.execution.strategy=in-process', '--no-daemon']);
    const builtApk = path.join(nativeDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
    if (!fs.existsSync(builtApk)) throw new Error('Gradle finished without an APK artifact.');
    const artifacts = path.join(root, 'artifacts');
    fs.mkdirSync(artifacts, { recursive: true });
    const output = path.join(artifacts, 'AlMadinah.apk');
    fs.copyFileSync(builtApk, output);
    console.log(`APK ready: ${output}`);
  } finally {
    delete process.env.ALMADINAH_STORE_PASSWORD;
    delete process.env.ALMADINAH_KEYSTORE;
  }
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
