// Project-local Android build tools from Google's official distribution.
// Running this installer accepts the licenses of the requested SDK packages.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const toolsDir = path.join(root, '.toolchain');
const sdkDir = path.join(toolsDir, 'android-sdk');
const filename = 'commandlinetools-win-15859902_latest.zip';
const expectedHash = '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a';
const sourceUrl = 'https://dl.google.com/android/repository/' + filename;

async function verify(file) {
  if (!fs.existsSync(file)) return false;
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex') === expectedHash;
}

async function main() {
  if (process.platform !== 'win32') throw new Error('This bootstrap downloads the Windows Android SDK tools.');
  const jdkCandidates = [process.env.JAVA_HOME, path.join(toolsDir, 'jdk'), 'C:\\Program Files\\Android\\Android Studio\\jbr'].filter(Boolean);
  const jdkDir = jdkCandidates.find((candidate) => fs.existsSync(path.join(candidate, 'bin', 'java.exe')));
  if (jdkDir) {
    process.env.JAVA_HOME = jdkDir;
    process.env.PATH = path.join(jdkDir, 'bin') + path.delimiter + process.env.PATH;
  }
  const java = spawnSync(jdkDir ? path.join(jdkDir, 'bin', 'java.exe') : 'java.exe', ['-version'], { encoding: 'utf8', windowsHide: true });
  if (java.error || java.status !== 0) throw new Error('Java is required before installing the Android SDK.');
  await fsp.mkdir(toolsDir, { recursive: true });
  const sdkManager = path.join(sdkDir, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat');
  if (!fs.existsSync(sdkManager)) {
    const archive = path.join(toolsDir, filename);
    if (!await verify(archive)) {
      console.log('Downloading official Google Android command-line tools (about 156 MB)...');
      const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(600_000) });
      if (!response.ok || !response.body) throw new Error(`SDK tools download failed: HTTP ${response.status}`);
      let received = 0, lastReported = 0;
      const stream = Readable.fromWeb(response.body);
      stream.on('data', (chunk) => {
        received += chunk.length;
        if (received - lastReported >= 20 * 1024 * 1024) {
          lastReported = received; console.log(`Downloaded ${Math.round(received / 1024 / 1024)} MB of Android command-line tools.`);
        }
      });
      await pipeline(stream, fs.createWriteStream(archive));
      if (!await verify(archive)) throw new Error('Android command-line tools SHA-256 verification failed.');
    }
    const unpackDir = path.join(toolsDir, 'cmdline-tools-unpacked');
    await fsp.mkdir(unpackDir, { recursive: true });
    const extract = spawnSync('tar.exe', ['-xf', archive, '-C', unpackDir], { stdio: 'inherit', windowsHide: true });
    if (extract.error || extract.status !== 0) throw new Error('Could not extract the verified Android tools archive.');
    await fsp.mkdir(path.dirname(path.dirname(sdkManager)), { recursive: true });
    await fsp.cp(path.join(unpackDir, 'cmdline-tools'), path.join(sdkDir, 'cmdline-tools', 'latest'), { recursive: true });
  }
  const versions = await fsp.readFile(path.join(root, 'node_modules', 'react-native', 'gradle', 'libs.versions.toml'), 'utf8');
  const version = (key) => {
    const hit = versions.match(new RegExp('^' + key + '\\s*=\\s*"([0-9.]+)"', 'm'));
    if (!hit) throw new Error('React Native does not declare ' + key);
    return hit[1];
  };
  const compileSdk = version('compileSdk');
  // Google publishes API 37+ platforms with an explicit minor version.
  const platformVersion = Number(compileSdk) >= 37 && !compileSdk.includes('.') ? compileSdk + '.0' : compileSdk;
  const packages = ['platform-tools', 'platforms;android-' + platformVersion,
    'build-tools;' + version('buildTools'), 'ndk;' + version('ndkVersion'), 'cmake;3.30.5'];
  console.log('Installing required Android SDK packages: ' + packages.join(', '));
  console.log('Only the requested packages and their required licenses are accepted. No emulator is installed.');
  await new Promise((resolve, reject) => {
    // Match Google's launcher without passing Windows paths through CMD quoting.
    const toolHome = path.join(sdkDir, 'cmdline-tools', 'latest');
    const javaExecutable = jdkDir ? path.join(jdkDir, 'bin', 'java.exe') : 'java.exe';
    const child = spawn(javaExecutable, [`-Dcom.android.sdklib.toolsdir=${toolHome}`, '-classpath',
      path.join(toolHome, 'lib', 'sdkmanager-classpath.jar'), 'com.android.sdklib.tool.sdkmanager.SdkManagerCli',
      `--sdk_root=${sdkDir}`, '--install', ...packages], {
      cwd: root, windowsHide: true, stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env, ANDROID_HOME: sdkDir, ANDROID_SDK_ROOT: sdkDir }
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Android SDK package installation failed with exit code ${code}.`)));
    child.stdin.on('error', () => {});
    child.stdin.end('y\r\n'.repeat(100));
  });
  console.log('Project-local Android SDK is ready. Run npm run build:apk.');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
