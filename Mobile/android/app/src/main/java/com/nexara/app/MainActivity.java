package com.nexara.app;

import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void load() {
        super.load();

        WebView webView =
                getBridge() != null
                        ? getBridge().getWebView()
                        : null;

        if (webView != null) {

            WebSettings settings =
                    webView.getSettings();

            // Allow the incoming-call ringtone and WebRTC audio to
            // start without a preceding on-screen tap (the Android
            // WebView blocks autoplay by default). Toll calls push a
            // real user interaction, but the callee's ringer must be
            // able to sound the moment a call_offer arrives.
            settings.setMediaPlaybackRequiresUserGesture(false);

            // Force the WebView to give CSS `width=device-width` a
            // true device-pixel viewport. Android System WebView can
            // otherwise default to a ~980px "wide viewport", which
            // makes the page report a width above 720px and silently
            // skips every mobile media query — so the desktop rail
            // shows instead of the bottom tab bar. Disabling the wide
            // viewport keeps the `@media (max-width: 720px)` blocks in
            // mobile.css active on real phone screens.
            settings.setUseWideViewPort(false);
            settings.setLoadWithOverviewMode(false);
            settings.setSupportZoom(false);

        }

    }

}