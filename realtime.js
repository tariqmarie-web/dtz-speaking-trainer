(function () {
  class DTZRealtimeClient {
    constructor(callbacks = {}) {
      this.callbacks = callbacks;
      this.pc = null;
      this.dc = null;
      this.localStream = null;
      this.audio = null;
      this.connected = false;
      this.ready = false;
      this.userTranscript = "";
      this.assistantTranscript = "";
      this.mode = "training";
      this.examPart = "3";
      this.trainingTopic = "plan";
      this.scenario = "";
      this.connectionTimer = null;
    }

    emit(name, payload) {
      const fn = this.callbacks[name];
      if (typeof fn === "function") fn(payload);
    }

    async connect(options = {}) {
      await this.disconnect();
      this.mode = options.mode || "training";
      this.examPart = options.examPart || "3";
      this.trainingTopic = options.trainingTopic || "plan";
      this.scenario = options.scenario || "";
      this.emit("status", "Mikrofon wird vorbereitet …");

      if (!window.isSecureContext && !["localhost", "127.0.0.1", "::1"].includes(location.hostname)) {
        throw new Error("Für Live-KI ist HTTPS erforderlich.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Dieser Browser unterstützt keinen Mikrofonzugriff über WebRTC.");
      }

      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      this.pc = new RTCPeerConnection();
      this.audio = document.createElement("audio");
      this.audio.autoplay = true;
      this.audio.playsInline = true;
      this.audio.setAttribute("aria-hidden", "true");
      document.body.appendChild(this.audio);

      this.audio.addEventListener("play", () => this.emit("speaking", true));
      this.audio.addEventListener("pause", () => this.emit("speaking", false));
      this.audio.addEventListener("ended", () => this.emit("speaking", false));
      this.pc.ontrack = (event) => {
        const stream = event.streams?.[0];
        if (stream) this.audio.srcObject = stream;
      };

      this.pc.addEventListener("connectionstatechange", () => {
        const state = this.pc?.connectionState;
        if (state === "failed") this.emit("error", new Error("WebRTC-Verbindung fehlgeschlagen."));
        if (state === "disconnected") this.emit("status", "Verbindung kurz unterbrochen …");
        if (state === "connected") this.emit("status", "Live-KI verbunden – einfach sprechen");
      });

      for (const track of this.localStream.getAudioTracks()) {
        this.pc.addTrack(track, this.localStream);
      }

      this.dc = this.pc.createDataChannel("oai-events");
      this.dc.addEventListener("open", () => {
        this.connected = true;
        this.emit("connected", true);
        this.emit("status", "Live-KI verbunden – einfach sprechen");
      });
      this.dc.addEventListener("close", () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.ready = false;
        if (wasConnected) this.emit("connected", false);
        this.emit("status", "Live-KI getrennt");
      });
      this.dc.addEventListener("message", (event) => this.handleEvent(event));

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await this.waitForIceGathering();
      const sdp = this.pc.localDescription?.sdp;
      if (!sdp) throw new Error("WebRTC-Angebot konnte nicht erstellt werden.");

      this.emit("status", "KI-Sitzung wird gestartet …");
      const response = await fetch("/api/realtime/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sdp,
          mode: this.mode,
          examPart: this.examPart,
          trainingTopic: this.trainingTopic,
          scenario: this.scenario,
          userId: localStorage.getItem("dtzUserId") || "anonymous"
        })
      });

      let data;
      try { data = await response.json(); } catch { data = null; }
      if (!response.ok) {
        throw new Error(data?.detail || data?.error || `Live-KI konnte nicht gestartet werden (${response.status}).`);
      }
      if (!data?.sdp) throw new Error("Der Server hat keine gültige WebRTC-Antwort geliefert.");

      await this.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
      await this.waitForDataChannel();
      return true;
    }

    waitForIceGathering(timeoutMs = 12_000) {
      if (!this.pc || this.pc.iceGatheringState === "complete") return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pc?.removeEventListener("icegatheringstatechange", onChange);
          reject(new Error("WebRTC-ICE-Timeout. Bitte Netzwerk prüfen."));
        }, timeoutMs);
        const onChange = () => {
          if (this.pc?.iceGatheringState !== "complete") return;
          clearTimeout(timer);
          this.pc.removeEventListener("icegatheringstatechange", onChange);
          resolve();
        };
        this.pc.addEventListener("icegatheringstatechange", onChange);
        onChange();
      });
    }

    waitForDataChannel(timeoutMs = 15_000) {
      if (this.dc?.readyState === "open") return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Live-KI-Verbindung Timeout")), timeoutMs);
        const onOpen = () => {
          clearTimeout(timer);
          this.dc?.removeEventListener("open", onOpen);
          resolve();
        };
        this.dc?.addEventListener("open", onOpen);
      });
    }

    send(event) {
      if (!this.dc || this.dc.readyState !== "open") return false;
      this.dc.send(JSON.stringify(event));
      return true;
    }

    handleEvent(messageEvent) {
      let event;
      try { event = JSON.parse(messageEvent.data); } catch { return; }
      this.emit("event", event);
      switch (event.type) {
        case "session.created":
        case "session.updated":
          this.ready = true;
          this.emit("ready", event.session || null);
          break;
        case "input_audio_buffer.speech_started":
          this.emit("listening", true);
          this.emit("status", "Ich höre zu …");
          break;
        case "input_audio_buffer.speech_stopped":
          this.emit("listening", false);
          this.emit("status", "Antwort wird verstanden …");
          break;
        case "conversation.item.input_audio_transcription.delta":
          this.userTranscript += event.delta || "";
          this.emit("userTranscriptDelta", { delta: event.delta || "", text: this.userTranscript });
          break;
        case "conversation.item.input_audio_transcription.completed":
          this.userTranscript = event.transcript || this.userTranscript;
          this.emit("userTranscript", this.userTranscript.trim());
          this.userTranscript = "";
          break;
        case "response.output_audio_transcript.delta":
          this.assistantTranscript += event.delta || "";
          this.emit("assistantTranscriptDelta", { delta: event.delta || "", text: this.assistantTranscript });
          break;
        case "response.output_audio_transcript.done":
          this.assistantTranscript = event.transcript || this.assistantTranscript;
          this.emit("assistantTranscript", this.assistantTranscript.trim());
          this.assistantTranscript = "";
          break;
        case "response.created":
          this.emit("status", "KI antwortet …");
          break;
        case "response.done":
          this.emit("responseDone", event.response);
          if (event.response?.status === "failed") this.emit("status", "KI-Antwort fehlgeschlagen");
          break;
        case "error":
          this.emit("error", event.error || event);
          this.emit("status", "Realtime-Fehler");
          break;
      }
    }

    startPrompt(instructions) {
      return this.send({
        type: "response.create",
        response: { output_modalities: ["audio"], instructions }
      });
    }

    updateInstructions(instructions) {
      return this.send({
        type: "session.update",
        session: { type: "realtime", instructions }
      });
    }

    cancelResponse() {
      this.send({ type: "response.cancel" });
    }

    setMuted(muted) {
      const track = this.localStream?.getAudioTracks?.()[0];
      if (track) track.enabled = !muted;
      this.emit("muted", muted);
      return Boolean(track);
    }

    async disconnect() {
      clearTimeout(this.connectionTimer);
      try { this.dc?.close(); } catch {}
      try { this.pc?.close(); } catch {}
      try { this.localStream?.getTracks().forEach((track) => track.stop()); } catch {}
      try { this.audio?.pause(); } catch {}
      try { this.audio?.remove(); } catch {}
      const wasConnected = this.connected;
      this.pc = null;
      this.dc = null;
      this.localStream = null;
      this.audio = null;
      this.connected = false;
      this.ready = false;
      this.userTranscript = "";
      this.assistantTranscript = "";
      if (wasConnected) this.emit("connected", false);
    }
  }

  window.DTZRealtimeClient = DTZRealtimeClient;
})();
