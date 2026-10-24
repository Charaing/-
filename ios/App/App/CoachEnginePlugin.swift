import Foundation
import UIKit
import AVFoundation
import MediaPlayer
import Capacitor

/// 훈련 타임라인의 한 이벤트 (JS 플래너가 미리 계산해서 넘겨준다)
private struct CoachEvent {
    let t: Double          // ms (훈련 시작 기준)
    let kind: String       // "speak" | "bell" | "beep"
    let text: String
    let priority: Int      // 1 = 라운드 안내(우선), 0 = 훈련 명령
    let rateMul: Double
    let strikes: Int
    let freq: Double
}

/// JS 숫자(NSNumber)를 안전하게 Double로
private func num(_ v: Any?) -> Double? {
    if let n = v as? NSNumber { return n.doubleValue }
    if let d = v as? Double { return d }
    if let i = v as? Int { return Double(i) }
    if let s = v as? String { return Double(s) }
    return nil
}

private struct CoachSegment {
    let phase: String      // "prep" | "work" | "rest"
    let round: Int
    let start: Double
    let end: Double
}

/**
 * BOXING VOICE COACH 네이티브 엔진
 * - AVSpeechSynthesizer로 한국어 음성 출력 (앱 오디오 세션 사용)
 * - 무음 루프로 오디오 세션을 유지 → 화면이 잠겨도 타이머·음성이 계속 진행 (UIBackgroundModes: audio)
 * - 벨/비프음은 PCM을 직접 합성해서 AVAudioPlayer로 재생
 * - 전화·알람 인터럽트, 이어폰 분리 시 자동 일시정지
 * - 잠금 화면 Now Playing + 재생/일시정지 원격 제어 (음악 단독 모드에서)
 */
@objc(CoachEnginePlugin)
public class CoachEnginePlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "CoachEnginePlugin"
    public let jsName = "CoachEngine"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSpeaking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getVoices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playSound", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKeepAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise)
    ]

    private let synth = AVSpeechSynthesizer()
    private var silentPlayer: AVAudioPlayer?
    private var sounds: [String: AVAudioPlayer] = [:]
    private var timer: DispatchSourceTimer?

    // 세션 상태
    private var events: [CoachEvent] = []
    private var segments: [CoachSegment] = []
    private var nextIndex = 0
    private var durationMs: Double = 0
    private var accumulatedMs: Double = 0
    private var resumedAt: CFTimeInterval = 0
    private var running = false
    private var active = false
    private var pendingCommand: CoachEvent?
    private var currentSegIndex = -1
    private var totalRounds = 0
    private var sessionTitle = "BOXING VOICE COACH"
    private var lastNowPlayingUpdate: CFTimeInterval = 0
    private var finishedFlag = false

    // 음성 설정
    private var baseRate: Double = 1.0
    private var volume: Float = 1.0
    private var pitch: Float = 1.0
    private var voiceId: String?
    private var audioMix = "mix" // "mix" | "duck" | "solo"
    private var keepAwakeInWorkout = true

    private var speakCalls: [ObjectIdentifier: CAPPluginCall] = [:]
    private var remoteReady = false

    override public func load() {
        synth.delegate = self
        synth.usesApplicationAudioSession = true
        let nc = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()
        nc.addObserver(self, selector: #selector(onInterruption(_:)), name: AVAudioSession.interruptionNotification, object: session)
        nc.addObserver(self, selector: #selector(onRouteChange(_:)), name: AVAudioSession.routeChangeNotification, object: session)
        nc.addObserver(self, selector: #selector(onMediaReset(_:)), name: AVAudioSession.mediaServicesWereResetNotification, object: session)
        DispatchQueue.main.async {
            self.prepareSounds()
        }
    }

    // MARK: - JS API

    @objc func configure(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.applyVoiceOptions(call)
            if let mix = call.getString("audioMix") { self.audioMix = mix }
            if let ka = call.getBool("keepAwake") { self.keepAwakeInWorkout = ka }
            call.resolve()
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        let rawEvents = (call.getArray("events") ?? []).compactMap { $0 as? JSObject }
        let rawSegs = (call.getArray("segments") ?? []).compactMap { $0 as? JSObject }
        let duration = call.getDouble("durationMs") ?? 0
        let startMs = call.getDouble("startMs") ?? 0
        let rounds = call.getInt("totalRounds") ?? 0
        let title = call.getString("title") ?? "BOXING VOICE COACH"

        var parsed: [CoachEvent] = []
        parsed.reserveCapacity(rawEvents.count)
        for e in rawEvents {
            parsed.append(CoachEvent(
                t: num(e["t"]) ?? 0,
                kind: (e["kind"] as? String) ?? "speak",
                text: (e["text"] as? String) ?? "",
                priority: Int(num(e["priority"]) ?? 0),
                rateMul: num(e["rate"]) ?? 1.0,
                strikes: Int(num(e["strikes"]) ?? 1),
                freq: num(e["freq"]) ?? 880
            ))
        }
        parsed.sort { $0.t < $1.t }
        var segs: [CoachSegment] = []
        for s in rawSegs {
            segs.append(CoachSegment(
                phase: (s["phase"] as? String) ?? "work",
                round: Int(num(s["round"]) ?? 1),
                start: num(s["start"]) ?? 0,
                end: num(s["end"]) ?? 0
            ))
        }

        DispatchQueue.main.async {
            self.applyVoiceOptions(call)
            if let mix = call.getString("audioMix") { self.audioMix = mix }
            if let ka = call.getBool("keepAwake") { self.keepAwakeInWorkout = ka }
            self.stopInternal(deactivate: false)

            guard self.activateSession() else {
                call.reject("오디오 세션을 시작할 수 없습니다. 다른 앱이 오디오를 독점하고 있거나 통화 중일 수 있습니다.", "AUDIO_SESSION")
                return
            }
            self.events = parsed
            self.segments = segs
            self.durationMs = duration
            self.totalRounds = rounds
            self.sessionTitle = title
            self.accumulatedMs = startMs
            self.nextIndex = parsed.firstIndex(where: { $0.t >= startMs - 1 }) ?? parsed.count
            self.currentSegIndex = -1
            self.pendingCommand = nil
            self.finishedFlag = false
            self.active = true
            self.startSilentLoop()
            self.setupRemoteCommandsIfNeeded()
            self.resumedAt = CACurrentMediaTime()
            self.running = true
            self.startTimer()
            if self.keepAwakeInWorkout { UIApplication.shared.isIdleTimerDisabled = true }
            self.updateNowPlaying(force: true)
            call.resolve(["ok": true])
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.pauseInternal(reason: "user")
            call.resolve(self.stateDict())
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        let cue = call.getString("cue")
        DispatchQueue.main.async {
            let ok = self.resumeInternal(cue: cue)
            if ok { call.resolve(self.stateDict()) } else { call.reject("재개할 수 없습니다. 통화 중이거나 오디오 세션이 막혀 있습니다.", "RESUME_FAILED") }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopInternal(deactivate: true)
            call.resolve()
        }
    }

    @objc func getState(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(self.stateDict())
        }
    }

    @objc func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.trimmingCharacters(in: .whitespaces).isEmpty else {
            call.resolve(["result": "end"])
            return
        }
        let rateMul = call.getDouble("rateMul") ?? 1.0
        let interrupt = call.getBool("interrupt") ?? false
        DispatchQueue.main.async {
            self.applyVoiceOptions(call)
            if !self.active {
                _ = self.activateSession()
            }
            if interrupt || self.synth.isSpeaking {
                self.synth.stopSpeaking(at: .immediate)
            }
            let u = self.makeUtterance(text, rateMul: rateMul)
            self.speakCalls[ObjectIdentifier(u)] = call
            self.synth.speak(u)
        }
    }

    @objc func stopSpeaking(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.pendingCommand = nil
            self.synth.stopSpeaking(at: .immediate)
            call.resolve()
        }
    }

    @objc func getVoices(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let voices = AVSpeechSynthesisVoice.speechVoices().map { v -> JSObject in
                var o = JSObject()
                o["id"] = v.identifier
                o["name"] = v.name
                o["lang"] = v.language
                o["quality"] = v.quality.rawValue
                return o
            }
            call.resolve(["voices": voices])
        }
    }

    @objc func playSound(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? "beep880"
        DispatchQueue.main.async {
            if !self.active { _ = self.activateSession() }
            self.play(name)
            call.resolve()
        }
    }

    @objc func setKeepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve()
        }
    }

    @objc func haptic(_ call: CAPPluginCall) {
        let style = call.getString("style") ?? "light"
        DispatchQueue.main.async {
            switch style {
            case "heavy":
                UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
            case "medium":
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            case "success":
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "warning":
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
            default:
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
            call.resolve()
        }
    }

    // MARK: - 세션 제어 (main thread)

    private func position() -> Double {
        if running {
            return accumulatedMs + (CACurrentMediaTime() - resumedAt) * 1000.0
        }
        return accumulatedMs
    }

    private func stateDict() -> PluginCallResultData {
        var seg: [String: Any] = [:]
        if currentSegIndex >= 0 && currentSegIndex < segments.count {
            let s = segments[currentSegIndex]
            seg = ["phase": s.phase, "round": s.round]
        }
        return [
            "position": position(),
            "running": running,
            "active": active,
            "finished": finishedFlag,
            "speaking": synth.isSpeaking,
            "durationMs": durationMs,
            "segment": seg
        ]
    }

    private func pauseInternal(reason: String) {
        guard active, running else { return }
        accumulatedMs = position()
        running = false
        pendingCommand = nil
        synth.stopSpeaking(at: .immediate)
        silentPlayer?.pause()
        updateNowPlaying(force: true)
        notifyListeners("state", data: ["status": "paused", "reason": reason, "position": accumulatedMs], retainUntilConsumed: true)
    }

    @discardableResult
    private func resumeInternal(cue: String?) -> Bool {
        guard active, !running, !finishedFlag else { return active && running }
        guard activateSession() else { return false }
        silentPlayer?.play()
        // 일시정지 동안 지난 이벤트는 다시 내보내지 않는다
        while nextIndex < events.count && events[nextIndex].t < accumulatedMs { nextIndex += 1 }
        resumedAt = CACurrentMediaTime()
        running = true
        if timer == nil { startTimer() }
        if let c = cue, !c.isEmpty, currentPhase() == "work" {
            synth.speak(makeUtterance(c, rateMul: 1.0))
        }
        updateNowPlaying(force: true)
        notifyListeners("state", data: ["status": "running", "reason": "resume", "position": accumulatedMs], retainUntilConsumed: true)
        return true
    }

    private func stopInternal(deactivate: Bool) {
        timer?.cancel()
        timer = nil
        let wasActive = active
        running = false
        active = false
        pendingCommand = nil
        events = []
        segments = []
        synth.stopSpeaking(at: .immediate)
        silentPlayer?.stop()
        UIApplication.shared.isIdleTimerDisabled = false
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        if deactivate && wasActive {
            deactivateSession()
        }
    }

    private func finishWorkout() {
        let pos = position()
        accumulatedMs = pos
        running = false
        finishedFlag = true
        timer?.cancel()
        timer = nil
        silentPlayer?.stop()
        UIApplication.shared.isIdleTimerDisabled = false
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        active = false
        notifyListeners("finished", data: ["position": pos], retainUntilConsumed: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            guard let self = self, !self.active else { return }
            self.deactivateSession()
        }
    }

    private func startTimer() {
        timer?.cancel()
        let t = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
        t.schedule(deadline: .now(), repeating: .milliseconds(50), leeway: .milliseconds(10))
        t.setEventHandler { [weak self] in self?.tick() }
        t.resume()
        timer = t
    }

    private func tick() {
        guard running else { return }
        let pos = position()
        while nextIndex < events.count && events[nextIndex].t <= pos {
            let e = events[nextIndex]
            nextIndex += 1
            // 지연이 크면(시스템이 잠깐 멈췄던 경우) 소리 없이 건너뛴다
            if pos - e.t < 2500 { fire(e) }
        }
        updateSegment(pos)
        let now = CACurrentMediaTime()
        if now - lastNowPlayingUpdate > 5 { updateNowPlaying(force: false) }
        if pos >= durationMs { finishWorkout() }
    }

    private func fire(_ e: CoachEvent) {
        switch e.kind {
        case "bell":
            play("bell\(min(3, max(1, e.strikes)))")
        case "beep":
            play(beepKey(e.freq))
        default:
            if e.priority > 0 {
                // 라운드 안내는 진행 중인 명령보다 우선
                pendingCommand = nil
                if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
                synth.speak(makeUtterance(e.text, rateMul: e.rateMul))
            } else if synth.isSpeaking {
                // 이전 음성이 끝나면 이어서 (겹치지 않게)
                pendingCommand = e
            } else {
                synth.speak(makeUtterance(e.text, rateMul: e.rateMul))
            }
        }
    }

    private func currentPhase() -> String {
        if currentSegIndex >= 0 && currentSegIndex < segments.count { return segments[currentSegIndex].phase }
        return ""
    }

    private func updateSegment(_ pos: Double) {
        var idx = -1
        for (i, s) in segments.enumerated() where pos >= s.start && pos < s.end {
            idx = i
            break
        }
        if idx != currentSegIndex {
            currentSegIndex = idx
            updateNowPlaying(force: true)
        }
    }

    // MARK: - 오디오 세션

    private func categoryOptions() -> AVAudioSession.CategoryOptions {
        switch audioMix {
        case "solo": return []
        case "duck": return [.mixWithOthers, .duckOthers]
        default: return [.mixWithOthers]
        }
    }

    @discardableResult
    private func activateSession() -> Bool {
        let s = AVAudioSession.sharedInstance()
        do {
            try s.setCategory(.playback, mode: .spokenAudio, options: categoryOptions())
            try s.setActive(true)
            return true
        } catch {
            CAPLog.print("[CoachEngine] audio session error: \(error)")
            return false
        }
    }

    private func deactivateSession() {
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            CAPLog.print("[CoachEngine] deactivate error: \(error)")
        }
    }

    @objc private func onInterruption(_ n: Notification) {
        guard let info = n.userInfo,
              let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        DispatchQueue.main.async {
            if type == .began {
                if self.running { self.pauseInternal(reason: "interruption") }
            } else {
                // 통화가 끝나도 자동 재개하지 않는다 — 사용자가 직접 재개
                self.notifyListeners("state", data: ["status": self.running ? "running" : "paused", "reason": "interruptionEnded", "position": self.position()], retainUntilConsumed: true)
            }
        }
    }

    @objc private func onRouteChange(_ n: Notification) {
        guard let info = n.userInfo,
              let raw = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
        if reason == .oldDeviceUnavailable {
            // 에어팟·이어폰이 빠지면 스피커로 갑자기 나오지 않도록 일시정지
            DispatchQueue.main.async {
                if self.running { self.pauseInternal(reason: "routeLost") }
            }
        }
    }

    @objc private func onMediaReset(_ n: Notification) {
        DispatchQueue.main.async {
            self.sounds = [:]
            self.silentPlayer = nil
            self.prepareSounds()
            if self.active {
                _ = self.activateSession()
                self.startSilentLoop()
                if !self.running { self.silentPlayer?.pause() }
            }
        }
    }

    // MARK: - 음성

    private func applyVoiceOptions(_ call: CAPPluginCall) {
        if let r = call.getDouble("rate") { baseRate = r }
        if let v = call.getDouble("volume") { volume = Float(max(0, min(1, v))) }
        if let p = call.getDouble("pitch") { pitch = Float(max(0.5, min(2.0, p))) }
        if let id = call.getString("voiceId") {
            voiceId = id.isEmpty ? nil : id
        }
    }

    private func preferredVoice() -> AVSpeechSynthesisVoice? {
        if let id = voiceId, let v = AVSpeechSynthesisVoice(identifier: id) { return v }
        let ko = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("ko") }
        if let best = ko.max(by: { $0.quality.rawValue < $1.quality.rawValue }) { return best }
        return AVSpeechSynthesisVoice(language: "ko-KR")
    }

    private func makeUtterance(_ text: String, rateMul: Double) -> AVSpeechUtterance {
        let u = AVSpeechUtterance(string: text)
        u.voice = preferredVoice()
        // 웹 기준 1.0배 ≈ iOS 기본 속도
        let r = Float(baseRate * rateMul) * AVSpeechUtteranceDefaultSpeechRate
        u.rate = max(AVSpeechUtteranceMinimumSpeechRate, min(AVSpeechUtteranceMaximumSpeechRate, r))
        u.volume = volume
        u.pitchMultiplier = pitch
        u.preUtteranceDelay = 0
        u.postUtteranceDelay = 0
        return u
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { self.utteranceEnded(utterance, finished: true) }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { self.utteranceEnded(utterance, finished: false) }
    }

    private func utteranceEnded(_ u: AVSpeechUtterance, finished: Bool) {
        if let call = speakCalls.removeValue(forKey: ObjectIdentifier(u)) {
            call.resolve(["result": finished ? "end" : "cancelled"])
            if !active && speakCalls.isEmpty && !synth.isSpeaking {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
                    guard let self = self, !self.active, !self.synth.isSpeaking else { return }
                    self.deactivateSession()
                }
            }
        }
        if running, let p = pendingCommand, !synth.isSpeaking {
            pendingCommand = nil
            if position() - p.t < 3000 {
                synth.speak(makeUtterance(p.text, rateMul: p.rateMul))
            }
        }
    }

    // MARK: - 효과음

    private func prepareSounds() {
        let defs: [(String, [Float])] = [
            ("bell1", bellSamples(strikes: 1)),
            ("bell2", bellSamples(strikes: 2)),
            ("bell3", bellSamples(strikes: 3)),
            ("beep660", beepSamples(freq: 660, dur: 0.15)),
            ("beep880", beepSamples(freq: 880, dur: 0.12)),
            ("beep990", beepSamples(freq: 990, dur: 0.14)),
            ("tick", beepSamples(freq: 1320, dur: 0.05))
        ]
        for (name, samples) in defs {
            if let p = try? AVAudioPlayer(data: wavData(samples)) {
                p.prepareToPlay()
                sounds[name] = p
            }
        }
        if silentPlayer == nil {
            silentPlayer = try? AVAudioPlayer(data: wavData([Float](repeating: 0, count: 44100)))
            silentPlayer?.numberOfLoops = -1
            silentPlayer?.volume = 0.0
            silentPlayer?.prepareToPlay()
        }
    }

    private func startSilentLoop() {
        if silentPlayer == nil { prepareSounds() }
        silentPlayer?.currentTime = 0
        silentPlayer?.play()
    }

    private func beepKey(_ f: Double) -> String {
        if f >= 1200 { return "tick" }
        if f >= 950 { return "beep990" }
        if f >= 770 { return "beep880" }
        return "beep660"
    }

    private func play(_ name: String) {
        guard let p = sounds[name] else { return }
        p.volume = max(0.1, volume)
        p.currentTime = 0
        p.play()
    }

    private func bellSamples(strikes: Int) -> [Float] {
        let sr = 44100.0
        let partials: [(Double, Double, Double)] = [(1180, 1.0, 1.6), (1180 * 2.76, 0.45, 0.9), (1180 * 5.4, 0.2, 0.5), (590, 0.25, 1.2)]
        let total = Int(sr * (1.7 + 0.32 * Double(strikes - 1)))
        var out = [Float](repeating: 0, count: total)
        for k in 0..<strikes {
            let off = Int(0.32 * Double(k) * sr)
            for (f, a, d) in partials {
                let n = Int(d * sr)
                var i = 0
                while i < n && off + i < total {
                    let t = Double(i) / sr
                    let attack = t < 0.004 ? t / 0.004 : 1.0
                    let env = attack * exp(-t * 6.9 / d)
                    out[off + i] += Float(0.3 * a * env * sin(2.0 * Double.pi * f * t))
                    i += 1
                }
            }
        }
        return out
    }

    private func beepSamples(freq: Double, dur: Double) -> [Float] {
        let sr = 44100.0
        let n = Int(sr * dur)
        var out = [Float](repeating: 0, count: n)
        for i in 0..<n {
            let t = Double(i) / sr
            let attack = min(1.0, t / 0.008)
            let release = min(1.0, (dur - t) / (dur * 0.4))
            out[i] = Float(0.45 * attack * max(0, release) * sin(2.0 * Double.pi * freq * t))
        }
        return out
    }

    private func wavData(_ samples: [Float], sampleRate: Int = 44100) -> Data {
        var d = Data()
        func appendU32(_ v: UInt32) {
            var x = v.littleEndian
            withUnsafeBytes(of: &x) { d.append(contentsOf: $0) }
        }
        func appendU16(_ v: UInt16) {
            var x = v.littleEndian
            withUnsafeBytes(of: &x) { d.append(contentsOf: $0) }
        }
        let byteCount = UInt32(samples.count * 2)
        d.append(contentsOf: Array("RIFF".utf8))
        appendU32(36 + byteCount)
        d.append(contentsOf: Array("WAVE".utf8))
        d.append(contentsOf: Array("fmt ".utf8))
        appendU32(16)
        appendU16(1)
        appendU16(1)
        appendU32(UInt32(sampleRate))
        appendU32(UInt32(sampleRate * 2))
        appendU16(2)
        appendU16(16)
        d.append(contentsOf: Array("data".utf8))
        appendU32(byteCount)
        for s in samples {
            let c = max(-1.0, min(1.0, s))
            appendU16(UInt16(bitPattern: Int16(c * 32767.0)))
        }
        return d
    }

    // MARK: - 잠금 화면

    private func setupRemoteCommandsIfNeeded() {
        guard !remoteReady else { return }
        remoteReady = true
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.isEnabled = true
        c.pauseCommand.isEnabled = true
        c.togglePlayPauseCommand.isEnabled = true
        _ = c.playCommand.addTarget { [weak self] _ in
            DispatchQueue.main.async { _ = self?.resumeInternal(cue: "계속!") }
            return .success
        }
        _ = c.pauseCommand.addTarget { [weak self] _ in
            DispatchQueue.main.async { self?.pauseInternal(reason: "remote") }
            return .success
        }
        _ = c.togglePlayPauseCommand.addTarget { [weak self] _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if self.running { self.pauseInternal(reason: "remote") } else { _ = self.resumeInternal(cue: "계속!") }
            }
            return .success
        }
        let unused: [MPRemoteCommand] = [c.nextTrackCommand, c.previousTrackCommand, c.skipForwardCommand, c.skipBackwardCommand, c.seekForwardCommand, c.seekBackwardCommand, c.changePlaybackPositionCommand]
        for cmd in unused {
            cmd.isEnabled = false
        }
    }

    private lazy var artwork: MPMediaItemArtwork? = {
        guard let path = Bundle.main.path(forResource: "public/icons/icon-512", ofType: "png"),
              let img = UIImage(contentsOfFile: path) else { return nil }
        return MPMediaItemArtwork(boundsSize: img.size) { _ in img }
    }()

    private func updateNowPlaying(force: Bool) {
        lastNowPlayingUpdate = CACurrentMediaTime()
        guard active else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        var title = sessionTitle
        if currentSegIndex >= 0 && currentSegIndex < segments.count {
            let s = segments[currentSegIndex]
            switch s.phase {
            case "work": title = totalRounds > 0 ? "ROUND \(s.round) / \(totalRounds)" : "훈련 중"
            case "rest": title = "휴식 · 다음 \(s.round)라운드"
            default: title = "준비"
            }
        }
        if !running { title += " · 일시정지" }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: "BOXING VOICE COACH",
            MPMediaItemPropertyPlaybackDuration: durationMs / 1000.0,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position() / 1000.0,
            MPNowPlayingInfoPropertyPlaybackRate: running ? 1.0 : 0.0
        ]
        if let art = artwork { info[MPMediaItemPropertyArtwork] = art }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}
