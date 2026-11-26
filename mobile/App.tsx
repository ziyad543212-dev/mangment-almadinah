import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Button, Image, Linking, PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { normalizeAppUrl, safeDownloadName } from './src/server-url';
import { WEB_BRIDGE } from './src/web-bridge';
import bundledUI from './src/generated-ui';

function configuredAppUrl() {
  try { return normalizeAppUrl(Constants.expoConfig?.extra?.appUrl || ''); }
  catch { return ''; }
}

function MobileApp() {
  const [appUrl] = useState(configuredAppUrl);
  const [viewKey, setViewKey] = useState(0);
  const [source] = useState(() => ({
    html: bundledUI.replace('__MANG_MOBILE_CONFIG__', JSON.stringify({ apiBaseUrl: appUrl ? appUrl + '/api' : '', offlineShell: true }).replace(/</g, '\\u003c')),
    baseUrl: (appUrl || 'https://almadinah.invalid') + '/',
  }));
  const [canGoBack, setCanGoBack] = useState(false);
  const [pageError, setPageError] = useState(false);
  const webView = useRef<WebView<object>>(null);
  const sharing = useRef(false);

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) { webView.current?.goBack(); return true; }
      return false;
    });
    return () => listener.remove();
  }, [canGoBack]);

  async function onMessage(event: WebViewMessageEvent) {
    if (event.nativeEvent.data.length > 36 * 1024 * 1024) return;
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'error' && typeof data.message === 'string') { Alert.alert('المدينة', data.message.slice(0, 250)); return; }
      if (data.type === 'camera' && typeof data.id === 'string' && /^\d+$/.test(data.id)) {
        const granted = Platform.OS !== 'android' || await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA) === PermissionsAndroid.RESULTS.GRANTED;
        webView.current?.injectJavaScript(`window.__mangCameraResult(${JSON.stringify(data.id)}, ${granted}); true;`);
        return;
      }
      if (data.type === 'print' && typeof data.html === 'string' && data.html.length < 5 * 1024 * 1024) {
        await Print.printAsync({ html: data.html }); return;
      }
      if (data.type !== 'download' || sharing.current || typeof data.data !== 'string' || !/^data:[^,]*;base64,[A-Za-z0-9+/=\r\n]*$/.test(data.data)) return;
      sharing.current = true;
      try {
        if (!await Sharing.isAvailableAsync()) throw new Error('مشاركة الملفات غير متاحة على هذا الجهاز.');
        if (!FileSystem.cacheDirectory) throw new Error('مجلد الملفات المؤقتة غير متاح.');
        const uri = FileSystem.cacheDirectory + safeDownloadName(data.name);
        await FileSystem.writeAsStringAsync(uri, data.data.slice(data.data.indexOf(',') + 1), { encoding: FileSystem.EncodingType.Base64 });
        await Sharing.shareAsync(uri, { mimeType: typeof data.mimeType === 'string' ? data.mimeType : 'application/octet-stream', dialogTitle: 'حفظ أو مشاركة الملف' });
      } finally { sharing.current = false; }
    } catch { Alert.alert('المدينة', 'تعذر إكمال العملية. أعد المحاولة.'); }
  }

  function connectionPanel(unconfigured = false) {
    return <View style={styles.connectionPanel}>
      <Image source={require('./assets/icon.png')} style={styles.logo} accessibilityLabel="المدينة" />
      <Text style={styles.title}>المدينة للحج والعمرة</Text>
      <Text style={styles.connectionMessage}>{unconfigured ? 'تعذر فتح التطبيق. يرجى التواصل مع الإدارة.' : 'تعذر عرض الواجهة. أعد فتحها للمحاولة مجددًا.'}</Text>
      {!unconfigured && <Button title="فتح الواجهة" color="#b8960c" onPress={() => { setPageError(false); setViewKey(key => key + 1); }} />}
    </View>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <WebView<object> key={viewKey} ref={webView} source={source} originWhitelist={['*']} style={styles.webView} javaScriptEnabled domStorageEnabled
        injectedJavaScript={WEB_BRIDGE} onMessage={onMessage} startInLoadingState setSupportMultipleWindows={false}
        renderLoading={() => <ActivityIndicator style={styles.loading} color="#b8960c" size="large" />}
        onNavigationStateChange={(state) => setCanGoBack(state.canGoBack)}
        renderError={() => <View />}
        onHttpError={() => setPageError(true)}
        onError={() => setPageError(true)} onLoad={() => setPageError(false)}
        onContentProcessDidTerminate={() => setViewKey(key => key + 1)}
        onShouldStartLoadWithRequest={(request) => {
          if (request.url === 'about:blank' || request.url.startsWith('blob:')) return true;
          try {
            const target = new URL(request.url);
            if (target.origin === new URL(source.baseUrl).origin && (!request.isTopFrame || target.pathname === new URL(source.baseUrl).pathname)) return true;
            if (['https:', 'http:', 'tel:', 'mailto:'].includes(target.protocol)) Linking.openURL(request.url).catch(() => {});
          } catch { /* Reject unknown navigation schemes. */ }
          return false;
        }}
      />
      {pageError && <View style={styles.errorOverlay}>{connectionPanel()}</View>}
    </SafeAreaView>
  );
}

export default function App() { return <SafeAreaProvider><MobileApp /></SafeAreaProvider>; }

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  logo: { width: 88, height: 88, alignSelf: 'center', borderRadius: 22, marginBottom: 16 },
  title: { color: '#d4af37', fontSize: 24, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  webView: { flex: 1, backgroundColor: '#fff' },
  loading: { position: 'absolute', alignSelf: 'center', top: '45%' },
  connectionPanel: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#1a1a2e' },
  connectionMessage: { color: '#fff', textAlign: 'center', lineHeight: 26, marginBottom: 24 },
  errorOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#1a1a2e' }
});
