import SwiftUI
import AppKit

struct WidgetExtensionRow: Codable, Identifiable {
    var id: String { extensionNumber }
    let extensionNumber: String
    let operatorName: String
    let status: String
    let connectedMinutesToday: Int

    enum CodingKeys: String, CodingKey {
        case extensionNumber = "extension"
        case operatorName
        case status
        case connectedMinutesToday
    }
}

struct WidgetActiveCall: Codable, Identifiable {
    let id: Int
    let callerNumber: String
    let callerName: String?
    let extensionNumber: String?
    let status: String
    let startedAt: String

    enum CodingKeys: String, CodingKey {
        case id, callerNumber, callerName, status, startedAt
        case extensionNumber = "extension"
    }
}

struct WidgetTodaySummary: Codable {
    let totalCalls: Int
    let answeredCalls: Int
    let missedCalls: Int
    let answerRate: Double
}

struct WidgetSummaryResponse: Codable {
    let enabled: Bool
    let updatedAt: String
    let extensions: [WidgetExtensionRow]
    let activeCalls: [WidgetActiveCall]
    let todaySummary: WidgetTodaySummary
}

@MainActor
final class CallsMonitorStore: ObservableObject {
    @Published var serverURL: String {
        didSet { UserDefaults.standard.set(serverURL, forKey: "radar_server_url") }
    }
    @Published var pin: String = ""
    @Published var isAuthenticated: Bool = false
    @Published var summary: WidgetSummaryResponse?
    @Published var errorMessage: String = ""
    @Published var isLoading: Bool = false
    @Published var showFloatingWidget: Bool = false {
        didSet { toggleFloatingWindow(showFloatingWidget) }
    }

    private var timer: Timer?
    private var floatingWindow: NSPanel?
    private var authToken: String = ""
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        return URLSession(configuration: config)
    }()

    init() {
        self.serverURL = UserDefaults.standard.string(forKey: "radar_server_url") ?? "http://127.0.0.1:3000"
        if let savedCode = UserDefaults.standard.string(forKey: "radar_monitor_code"), !savedCode.isEmpty {
            self.pin = savedCode
            Task { await authenticateAndStart() }
        }
    }

    var menuBarTitle: String {
        guard isAuthenticated, let summary else { return "Radar PBX" }
        let onlineCount = summary.extensions.filter { $0.status == "online" || $0.status == "in_call" }.count
        let total = summary.extensions.count
        let active = summary.activeCalls.count
        if active > 0 {
            return "\(onlineCount)/\(total) · \(active) activa\(active == 1 ? "" : "s")"
        }
        return "\(onlineCount)/\(total) ext"
    }

    func authenticateAndStart() async {
        let trimmedURL = serverURL.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let trimmedCode = pin.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedURL.isEmpty, !trimmedCode.isEmpty else {
            errorMessage = "Ingresa la URL del servidor y el código."
            return
        }
        guard let url = URL(string: "\(trimmedURL)/api/pbx/monitor-auth") else {
            errorMessage = "URL inválida."
            return
        }
        isLoading = true
        errorMessage = ""
        defer { isLoading = false }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(trimmedURL, forHTTPHeaderField: "Origin")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["code": trimmedCode])

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                errorMessage = "Respuesta inválida del servidor."
                return
            }
            if http.statusCode >= 200 && http.statusCode < 300 {
                let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])
                self.authToken = (json?["token"] as? String) ?? ""
                UserDefaults.standard.set(trimmedCode, forKey: "radar_monitor_code")
                isAuthenticated = true
                await refresh()
                startPolling()
            } else {
                let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["message"] as? String
                errorMessage = msg ?? "Código inválido (\(http.statusCode))."
                isAuthenticated = false
            }
        } catch {
            errorMessage = "Sin conexión con \(trimmedURL)"
            isAuthenticated = false
        }
    }

    func logout() {
        timer?.invalidate()
        timer = nil
        UserDefaults.standard.removeObject(forKey: "radar_monitor_code")
        pin = ""
        authToken = ""
        isAuthenticated = false
        summary = nil
        errorMessage = ""
    }

    func startPolling() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                await self.refresh()
            }
        }
    }

    func refresh() async {
        let trimmedURL = serverURL.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: "\(trimmedURL)/api/pbx/widget-summary") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        if !authToken.isEmpty {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { return }
            if http.statusCode == 401 {
                await authenticateAndStart()
                return
            }
            if http.statusCode == 200 {
                let decoded = try JSONDecoder().decode(WidgetSummaryResponse.self, from: data)
                self.summary = decoded
                self.errorMessage = ""
            } else {
                self.errorMessage = "Error HTTP \(http.statusCode)"
            }
        } catch {
            self.errorMessage = "Error de red al actualizar."
        }
    }

    private func toggleFloatingWindow(_ visible: Bool) {
        if visible {
            if floatingWindow == nil {
                let panel = NSPanel(
                    contentRect: NSRect(x: 80, y: 80, width: 320, height: 280),
                    styleMask: [.titled, .closable, .nonactivatingPanel, .utilityWindow],
                    backing: .buffered,
                    defer: false
                )
                panel.title = "Radar · Llamadas en Vivo"
                panel.isFloatingPanel = true
                panel.level = .floating
                panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
                panel.isMovableByWindowBackground = true
                panel.contentView = NSHostingView(rootView: FloatingWidgetView(store: self))
                floatingWindow = panel
            }
            floatingWindow?.makeKeyAndOrderFront(nil)
        } else {
            floatingWindow?.orderOut(nil)
        }
    }
}

struct MonitorContentView: View {
    @ObservedObject var store: CallsMonitorStore

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Radar · Monitor PBX", systemImage: "phone.connection.fill")
                    .font(.headline)
                Spacer()
                if store.isAuthenticated {
                    Button {
                        Task { await store.refresh() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.borderless)
                    .help("Actualizar ahora")
                }
            }

            if !store.isAuthenticated {
                VStack(alignment: .leading, spacing: 8) {
                    TextField("URL (ej. http://127.0.0.1:3000)", text: $store.serverURL)
                        .textFieldStyle(.roundedBorder)
                    SecureField("Código de acceso al monitor", text: $store.pin)
                        .textFieldStyle(.roundedBorder)
                    if !store.errorMessage.isEmpty {
                        Text(store.errorMessage)
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                    Button(store.isLoading ? "Conectando..." : "Conectar Monitor") {
                        Task { await store.authenticateAndStart() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(store.isLoading)
                }
            } else if let summary = store.summary {
                HStack(spacing: 10) {
                    StatBadge(title: "Total", value: "\(summary.todaySummary.totalCalls)", color: .blue)
                    StatBadge(title: "Contest.", value: "\(summary.todaySummary.answeredCalls)", color: .green)
                    StatBadge(title: "Perdidas", value: "\(summary.todaySummary.missedCalls)", color: .red)
                }

                if !summary.activeCalls.isEmpty {
                    Divider()
                    Text("Llamadas activas (\(summary.activeCalls.count))")
                        .font(.caption.bold())
                        .foregroundColor(.secondary)
                    ForEach(summary.activeCalls) { call in
                        HStack {
                            Circle().fill(Color.blue).frame(width: 8, height: 8)
                            Text(call.callerName ?? call.callerNumber)
                                .font(.caption.bold())
                                .lineLimit(1)
                            Spacer()
                            Text(call.extensionNumber ?? call.status)
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                }

                Divider()
                Text("Extensiones (\(summary.extensions.count))")
                    .font(.caption.bold())
                    .foregroundColor(.secondary)

                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(summary.extensions) { ext in
                            HStack(spacing: 8) {
                                Circle()
                                    .fill(statusColor(ext.status))
                                    .frame(width: 8, height: 8)
                                Text(ext.extensionNumber)
                                    .font(.caption.monospacedDigit().bold())
                                Text(ext.operatorName)
                                    .font(.caption)
                                    .lineLimit(1)
                                Spacer()
                                Text("\(ext.connectedMinutesToday)m")
                                    .font(.caption2.monospacedDigit())
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                }
                .frame(maxHeight: 160)

                if !store.errorMessage.isEmpty {
                    Text(store.errorMessage)
                        .font(.caption2)
                        .foregroundColor(.orange)
                }

                Divider()
                HStack {
                    Toggle("Widget flotante", isOn: $store.showFloatingWidget)
                        .toggleStyle(.switch)
                        .font(.caption)
                    Spacer()
                    Button("Salir") {
                        store.logout()
                    }
                    .font(.caption)
                    .buttonStyle(.borderless)
                }
            } else {
                ProgressView("Cargando estado PBX...")
                    .frame(maxWidth: .infinity, alignment: .center)
            }

            Divider()
            HStack {
                Text(store.serverURL)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                Spacer()
                Button("Cerrar app") {
                    NSApplication.shared.terminate(nil)
                }
                .font(.caption2)
                .buttonStyle(.borderless)
            }
        }
        .padding(14)
        .frame(width: 310)
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "online": return .green
        case "in_call": return .blue
        case "offline": return .gray
        default: return .orange
        }
    }
}

struct FloatingWidgetView: View {
    @ObservedObject var store: CallsMonitorStore

    var body: some View {
        MonitorContentView(store: store)
            .background(.ultraThinMaterial)
    }
}

struct StatBadge: View {
    let title: String
    let value: String
    let color: Color

    var body: some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(.callout, design: .rounded).bold())
                .foregroundColor(color)
            Text(title)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(color.opacity(0.12))
        .cornerRadius(8)
    }
}

@main
struct RadarCallsMonitorApp: App {
    @StateObject private var store = CallsMonitorStore()

    var body: some Scene {
        MenuBarExtra {
            MonitorContentView(store: store)
        } label: {
            Label(store.menuBarTitle, systemImage: "phone.fill")
        }
        .menuBarExtraStyle(.window)
    }
}
