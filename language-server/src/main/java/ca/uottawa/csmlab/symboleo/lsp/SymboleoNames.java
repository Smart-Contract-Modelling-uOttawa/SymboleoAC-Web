package ca.uottawa.csmlab.symboleo.lsp;

import ca.uottawa.csmlab.symboleo.symboleo.Attribute;
import ca.uottawa.csmlab.symboleo.symboleo.DomainType;
import ca.uottawa.csmlab.symboleo.symboleo.EnumItem;
import ca.uottawa.csmlab.symboleo.symboleo.Enumeration;
import ca.uottawa.csmlab.symboleo.symboleo.Model;
import ca.uottawa.csmlab.symboleo.symboleo.Obligation;
import ca.uottawa.csmlab.symboleo.symboleo.OntologyType;
import ca.uottawa.csmlab.symboleo.symboleo.Parameter;
import ca.uottawa.csmlab.symboleo.symboleo.Power;
import ca.uottawa.csmlab.symboleo.symboleo.RegularType;
import ca.uottawa.csmlab.symboleo.symboleo.Rule;
import ca.uottawa.csmlab.symboleo.symboleo.Variable;
import org.eclipse.emf.ecore.EObject;
import org.eclipse.emf.ecore.EStructuralFeature;
import org.eclipse.xtext.Keyword;
import org.eclipse.xtext.RuleCall;
import org.eclipse.xtext.nodemodel.ICompositeNode;
import org.eclipse.xtext.nodemodel.ILeafNode;
import org.eclipse.xtext.nodemodel.INode;
import org.eclipse.xtext.nodemodel.util.NodeModelUtils;
import org.eclipse.xtext.parser.IParseResult;
import org.eclipse.xtext.resource.XtextResource;
import org.eclipse.xtext.util.ITextRegion;
import org.eclipse.xtext.util.TextRegion;

import java.util.ArrayList;
import java.util.List;

/**
 * Name-based navigation helpers shared by the definition, hover and rename
 * services. The upstream grammar refers to declared names with plain
 * identifiers ({@code VariableRef: variable=ID}) rather than cross-references,
 * so these helpers resolve an identifier token by looking it up among the
 * declarations of the same document.
 */
final class SymboleoNames {

    private SymboleoNames() {}

    /** The identifier token under the cursor, or null (keywords, attributes after ".", other tokens). */
    static ILeafNode identifierAt(XtextResource resource, int offset) {
        IParseResult pr = resource.getParseResult();
        if (pr == null) return null;
        ICompositeNode root = pr.getRootNode();
        ILeafNode leaf = NodeModelUtils.findLeafNodeAtOffset(root, offset);
        if (leaf == null || !isIdentifier(leaf)) {
            // cursor right after the last character of a word
            ILeafNode prev = offset > 0 ? NodeModelUtils.findLeafNodeAtOffset(root, offset - 1) : null;
            if (prev == null || !isIdentifier(prev)) return null;
            leaf = prev;
        }
        return afterDot(leaf) ? null : leaf;
    }

    /** Identifier token (an ID terminal, or a word that is not a keyword). */
    static boolean isIdentifier(ILeafNode leaf) {
        if (leaf.isHidden()) return false;
        if (leaf.getGrammarElement() instanceof RuleCall rc && rc.getRule() != null && "ID".equals(rc.getRule().getName())) return true;
        return leaf.getText().matches("[A-Za-z_]\\w*") && !(leaf.getGrammarElement() instanceof Keyword);
    }

    /** True when the previous visible token ends with "." (an attribute or dotted-name tail). */
    static boolean afterDot(ILeafNode leaf) {
        INode prev = leaf.getPreviousSibling();
        while (prev instanceof ILeafNode pl && pl.isHidden()) prev = prev.getPreviousSibling();
        if (prev == null) {
            ICompositeNode parent = leaf.getParent();
            prev = parent != null ? parent.getPreviousSibling() : null;
            while (prev instanceof ILeafNode pl && pl.isHidden()) prev = prev.getPreviousSibling();
        }
        String t = prev instanceof ILeafNode pl ? pl.getText() : (prev != null ? prev.getText().trim() : "");
        return t.endsWith(".");
    }

    /** Declarations in the document whose name equals {@code name}. */
    static List<EObject> declarations(XtextResource resource, String name) {
        List<EObject> out = new ArrayList<>();
        if (name == null || resource.getContents().isEmpty() || !(resource.getContents().get(0) instanceof Model m)) return out;
        for (Parameter p : m.getParameters()) if (name.equals(p.getName())) out.add(p);
        for (Variable v : m.getVariables()) if (name.equals(v.getName())) out.add(v);
        for (DomainType dt : m.getDomainTypes()) {
            if (name.equals(dt.getName())) out.add(dt);
            if (dt instanceof Enumeration en) for (EnumItem it : en.getEnumerationItems()) if (name.equals(it.getName())) out.add(it);
        }
        for (Obligation o : m.getObligations()) if (name.equals(o.getName())) out.add(o);
        for (Obligation o : m.getSurvivingObligations()) if (name.equals(o.getName())) out.add(o);
        for (Power p : m.getPowers()) if (name.equals(p.getName())) out.add(p);
        for (Rule r : m.getRules()) if (name.equals(r.getName())) out.add(r);
        return out;
    }

    /** Every identifier token in the document with the given text, excluding attribute names after ".". */
    static List<ILeafNode> occurrences(XtextResource resource, String name) {
        List<ILeafNode> out = new ArrayList<>();
        IParseResult pr = resource.getParseResult();
        if (pr == null) return out;
        for (INode n : pr.getRootNode().getAsTreeIterable()) {
            if (n instanceof ILeafNode l && isIdentifier(l) && name.equals(l.getText()) && !afterDot(l)) out.add(l);
        }
        return out;
    }

    /** Text region of the declaration's name token (falls back to the whole declaration). */
    static ITextRegion nameRegion(EObject decl) {
        EStructuralFeature nameFeature = decl.eClass().getEStructuralFeature("name");
        if (nameFeature != null) {
            List<INode> nodes = NodeModelUtils.findNodesForFeature(decl, nameFeature);
            if (!nodes.isEmpty()) return new TextRegion(nodes.get(0).getOffset(), nodes.get(0).getLength());
        }
        INode n = NodeModelUtils.getNode(decl);
        return n == null ? new TextRegion(0, 0) : new TextRegion(n.getOffset(), n.getLength());
    }

    /** "Role", "Event", "Asset", "DataTransfer", "Resource" or "" for a domain type, following inheritance. */
    static String category(RegularType t) {
        int guard = 0;
        while (t != null && guard++ < 16) {
            OntologyType ot = t.getOntologyType();
            if (ot != null) return ot.getName() == null ? "" : ot.getName();
            if (t.getAResource() != null) return "Resource";
            RegularType p = t.getRegularType();
            if (p == null || p.eIsProxy()) return "";
            t = p;
        }
        return "";
    }

    /** One-line kind label for a declaration, e.g. "Variable of type Manufacturer (Role)". */
    static String describe(EObject decl) {
        if (decl instanceof Variable v) {
            RegularType t = v.getType();
            String type = t == null || t.eIsProxy() ? "" : t.getName();
            String cat = t == null || t.eIsProxy() ? "" : category(t);
            return "Declared " + (cat.isEmpty() ? "variable" : cat.toLowerCase() + " instance") + (type.isEmpty() ? "" : " of type " + type);
        }
        if (decl instanceof Parameter p) {
            String type = p.getType() == null ? "" : p.getType().getBaseType() != null ? p.getType().getBaseType().getName()
                    : p.getType().getDomainType() != null && !p.getType().getDomainType().eIsProxy() ? p.getType().getDomainType().getName() : "";
            return "Contract parameter" + (type.isEmpty() ? "" : " of type " + type);
        }
        if (decl instanceof Enumeration) return "Enumeration";
        if (decl instanceof EnumItem it) {
            EObject e = it.eContainer();
            return "Value of enumeration " + (e instanceof Enumeration en ? en.getName() : "");
        }
        if (decl instanceof RegularType rt) {
            String cat = category(rt);
            boolean third = rt.getThirdParty() != null;
            return "Domain type" + (cat.isEmpty() ? "" : " (" + cat + (third ? ", third party" : "") + ")");
        }
        if (decl instanceof DomainType) return "Domain type";
        if (decl instanceof Attribute a) {
            String type = a.getBaseType() != null ? a.getBaseType().getName()
                    : a.getDomainType() != null && !a.getDomainType().eIsProxy() ? a.getDomainType().getName() : "";
            EObject owner = a.eContainer();
            return "Attribute" + (type.isEmpty() ? "" : " of type " + type) + (a.getAttributeModifier() != null ? " (Env)" : "")
                    + (owner instanceof DomainType dt ? " of " + dt.getName() : "");
        }
        if (decl instanceof Obligation o) {
            boolean surviving = o.eContainer() instanceof Model m && m.getSurvivingObligations().contains(o);
            return (surviving ? "Surviving obligation" : "Obligation") + ": " + text(o.getDebtor()) + " owes " + text(o.getCreditor());
        }
        if (decl instanceof Power p) return "Power: held by " + text(p.getCreditor()) + " against " + text(p.getDebtor());
        if (decl instanceof Rule r) return "Access-control rule (" + r.getAction() + " " + (r.getPermission() == null ? "" : r.getPermission().getName()) + ")";
        return decl.eClass().getName();
    }

    /** Source text of a declaration, whitespace-collapsed and truncated for hovers. */
    static String excerpt(EObject decl, int max) {
        INode n = NodeModelUtils.getNode(decl);
        if (n == null) return "";
        String t = n.getText().trim().replaceAll("\\s+", " ");
        return t.length() > max ? t.substring(0, max - 1) + "…" : t;
    }

    static String text(EObject e) {
        INode n = e == null ? null : NodeModelUtils.getNode(e);
        return n == null ? "?" : n.getText().trim();
    }
}
