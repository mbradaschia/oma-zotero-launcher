import SwiftUI

// Pills that wrap: left to right, a new line when the next one doesn't fit (a paper's taxonomy strip, the footer's
// pills). With no width offered (a scroll view's axis) it is one line.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 4

    // Which items go on each line: an item starts a new line when it would pass maxWidth, unless the line is empty
    // (an item wider than the width gets a line of its own).
    static func lines(widths: [CGFloat], maxWidth: CGFloat, spacing: CGFloat) -> [[Int]] {
        var lines: [[Int]] = []
        var line: [Int] = []
        var used: CGFloat = 0
        for (i, w) in widths.enumerated() {
            let needed = line.isEmpty ? w : used + spacing + w
            if !line.isEmpty, needed > maxWidth {
                lines.append(line)
                line = [i]
                used = w
            } else {
                line.append(i)
                used = needed
            }
        }
        if !line.isEmpty { lines.append(line) }
        return lines
    }

    private func arrange(_ sizes: [CGSize], maxWidth: CGFloat) -> (origins: [CGPoint], size: CGSize) {
        var origins = Array(repeating: CGPoint.zero, count: sizes.count)
        var y: CGFloat = 0
        var widest: CGFloat = 0
        let lines = Self.lines(widths: sizes.map(\.width), maxWidth: maxWidth, spacing: spacing)
        for (n, line) in lines.enumerated() {
            let height = line.map { sizes[$0].height }.max() ?? 0
            var x: CGFloat = 0
            for i in line {
                // (each centred on its line: a caption beside a pill sits on the pill's middle)
                origins[i] = CGPoint(x: x, y: y + (height - sizes[i].height) / 2)
                x += sizes[i].width + spacing
            }
            widest = max(widest, x - spacing)
            y += height + (n < lines.count - 1 ? lineSpacing : 0)
        }
        return (origins, CGSize(width: widest, height: y))
    }

    // Each item's own size; one wider than the line is measured again at the line's width (its text wraps).
    private func measure(_ subviews: Subviews, maxWidth: CGFloat) -> [CGSize] {
        subviews.map { v in
            let s = v.sizeThatFits(.unspecified)
            return s.width <= maxWidth ? s : v.sizeThatFits(ProposedViewSize(width: maxWidth, height: nil))
        }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        return arrange(measure(subviews, maxWidth: maxWidth), maxWidth: maxWidth).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let sizes = measure(subviews, maxWidth: bounds.width)
        let origins = arrange(sizes, maxWidth: bounds.width).origins
        for (i, subview) in subviews.enumerated() {
            // one that fits at its own size (offered exactly its width, a stack can round down and cut its text)
            let fits = subview.sizeThatFits(.unspecified).width <= bounds.width
            subview.place(at: CGPoint(x: bounds.minX + origins[i].x, y: bounds.minY + origins[i].y),
                          proposal: fits ? .unspecified : ProposedViewSize(width: bounds.width, height: nil))
        }
    }
}
