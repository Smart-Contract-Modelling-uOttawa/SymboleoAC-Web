package ca.uottawa.csmlab.symboleo.lsp;

import ca.uottawa.csmlab.symboleo.symboleo.Attribute;
import ca.uottawa.csmlab.symboleo.symboleo.DomainType;
import ca.uottawa.csmlab.symboleo.symboleo.EnumItem;
import ca.uottawa.csmlab.symboleo.symboleo.Obligation;
import ca.uottawa.csmlab.symboleo.symboleo.Parameter;
import ca.uottawa.csmlab.symboleo.symboleo.Power;
import ca.uottawa.csmlab.symboleo.symboleo.Rule;
import ca.uottawa.csmlab.symboleo.symboleo.Variable;
import org.eclipse.emf.ecore.EObject;
import org.eclipse.lsp4j.MarkupContent;
import org.eclipse.lsp4j.MarkupKind;
import org.eclipse.xtext.ide.server.hover.HoverContext;
import org.eclipse.xtext.ide.server.hover.HoverService;
import org.eclipse.xtext.nodemodel.ILeafNode;
import org.eclipse.xtext.nodemodel.INode;
import org.eclipse.xtext.nodemodel.util.NodeModelUtils;

import java.util.ArrayList;
import java.util.List;

/**
 * Hover for SymboleoAC: shows what an identifier denotes and its declaration.
 *
 * For real cross-references (attributes after ".", {@code obligations.X}) the
 * element resolved by Xtext is described directly. For plain-identifier
 * references (variables, norms, rules, types — see {@link SymboleoNames}) the
 * declarations with that name are looked up. The hover shows the kind of
 * element, an excerpt of its declaration and its line, plus the specifier's
 * comment written directly above a norm when there is one.
 */
public class SymboleoHoverService extends HoverService {

    @Override
    protected MarkupContent getMarkupContent(HoverContext ctx) {
        List<EObject> targets = new ArrayList<>();
        EObject el = ctx.getElement();
        if (isDeclaration(el)) {
            targets.add(el);
        } else {
            ILeafNode leaf = SymboleoNames.identifierAt(ctx.getResource(), ctx.getOffset());
            if (leaf != null) targets.addAll(SymboleoNames.declarations(ctx.getResource(), leaf.getText()));
        }
        if (targets.isEmpty()) return super.getMarkupContent(ctx);
        StringBuilder md = new StringBuilder();
        for (EObject t : targets) {
            if (md.length() > 0) md.append("\n\n---\n\n");
            md.append("**").append(SymboleoNames.describe(t)).append("**");
            INode n = NodeModelUtils.getNode(t);
            if (n != null) md.append("  \nline ").append(n.getStartLine());
            String note = authorNote(t, ctx.getDocument().getContents());
            if (note != null) md.append("  \n_").append(note.replace("_", "\\_")).append("_");
            String excerpt = SymboleoNames.excerpt(t, 240);
            if (!excerpt.isEmpty()) md.append("\n\n```symboleoac\n").append(excerpt).append("\n```");
        }
        return new MarkupContent(MarkupKind.MARKDOWN, md.toString());
    }

    private static boolean isDeclaration(EObject e) {
        return e instanceof Variable || e instanceof Parameter || e instanceof DomainType || e instanceof EnumItem
                || e instanceof Attribute || e instanceof Obligation || e instanceof Power || e instanceof Rule;
    }

    /** Comment lines directly above a norm (same rule as the Explain tab's "Specifier's note"). */
    private static String authorNote(EObject decl, String source) {
        if (!(decl instanceof Obligation || decl instanceof Power)) return null;
        INode n = NodeModelUtils.getNode(decl);
        if (n == null || source == null) return null;
        String[] lines = source.split("\r?\n", -1);
        int line = n.getStartLine() - 1;
        List<String> notes = new ArrayList<>();
        for (int i = line - 1; i >= 0 && i < lines.length; i--) {
            String t = lines[i].trim();
            if (t.startsWith("//")) { notes.add(0, t.substring(2).trim()); continue; }
            break;
        }
        String joined = String.join(" ", notes).replaceAll("\\s+", " ").trim();
        return joined.isEmpty() ? null : joined;
    }
}
