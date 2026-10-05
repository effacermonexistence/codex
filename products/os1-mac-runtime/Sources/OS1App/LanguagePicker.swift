import OS1Context
import SwiftUI

/// The language control from Codex's Settings → General → Language: title and
/// description on the left; on the right a button naming the current choice,
/// which opens a searchable list — the automatic choice first, then every
/// language under its own name, with the active one checked.
struct LanguagePickerRow: View {
    let title: String
    let description: String
    /// Label of the automatic choice ("Auto detect"); a nil selection is it.
    let automaticTitle: String
    let languages: [OS1Language]
    /// Catalog code of the current choice, nil for automatic. A value outside
    /// the catalog (a name typed into settings.json) shows as written.
    let selection: String?
    let select: (String?) -> Void

    @State private var isOpen = false
    @Environment(\.colorScheme) private var colorScheme

    private var currentTitle: String {
        guard let selection else { return automaticTitle }
        return OS1LanguageCatalog.all.first { $0.code == selection }?.nativeName ?? selection
    }

    var body: some View {
        LabeledContent {
            Button { isOpen.toggle() } label: {
                HStack(spacing: 5) {
                    Text(verbatim: currentTitle).lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
            }
            .accessibilityLabel(title)
            .accessibilityValue(currentTitle)
            .popover(isPresented: $isOpen, arrowEdge: .bottom) {
                LanguagePickerList(automaticTitle: automaticTitle, languages: languages, selection: selection) { code in
                    isOpen = false
                    if code != selection { select(code) }
                }
                .environment(\.colorScheme, colorScheme)
            }
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: title)
                Text(verbatim: description).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

/// The popover list: search field, the automatic choice (always shown, as in
/// Codex), then the languages the query matches.
private struct LanguagePickerList: View {
    let automaticTitle: String
    let languages: [OS1Language]
    let selection: String?
    let choose: (String?) -> Void

    @State private var query = ""
    @FocusState private var searchFocused: Bool
    private static let rowHeight: CGFloat = 24
    private static let maximumListHeight: CGFloat = 320

    var body: some View {
        let matches = OS1LanguageCatalog.filter(languages, query: query)
        VStack(alignment: .leading, spacing: 6) {
            TextField(os1Tr("언어 검색", "Search languages"), text: $query)
                .textFieldStyle(.roundedBorder)
                .focused($searchFocused)
                .onSubmit { if let first = matches.first { choose(first.code) } }
            LanguagePickerItem(title: automaticTitle, selected: selection == nil, height: Self.rowHeight) { choose(nil) }
            Divider()
            if matches.isEmpty {
                Text(os1Tr("일치하는 언어가 없습니다", "No matching languages"))
                    .font(.footnote).foregroundStyle(.secondary)
                    .frame(height: Self.rowHeight)
                    .padding(.horizontal, 8)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(matches) { language in
                            LanguagePickerItem(title: language.nativeName, selected: language.code == selection,
                                               height: Self.rowHeight) { choose(language.code) }
                        }
                    }
                }
                .frame(height: min(CGFloat(matches.count) * Self.rowHeight, Self.maximumListHeight))
            }
        }
        .padding(8)
        .frame(width: 280)
        .onAppear { searchFocused = true }
    }
}

private struct LanguagePickerItem: View {
    let title: String
    let selected: Bool
    let height: CGFloat
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(verbatim: title).lineLimit(1)
                Spacer(minLength: 8)
                if selected {
                    Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold))
                }
            }
            .padding(.horizontal, 8)
            .frame(height: height)
            .contentShape(Rectangle())
            .background(RoundedRectangle(cornerRadius: 5).fill(hovering ? Color.accentColor.opacity(0.25) : Color.clear))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
