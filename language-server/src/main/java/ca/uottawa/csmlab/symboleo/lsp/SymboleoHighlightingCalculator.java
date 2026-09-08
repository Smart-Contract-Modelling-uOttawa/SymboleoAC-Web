package ca.uottawa.csmlab.symboleo.lsp;

import ca.uottawa.csmlab.symboleo.symboleo.Attribute;
import ca.uottawa.csmlab.symboleo.symboleo.DomainType;
import ca.uottawa.csmlab.symboleo.symboleo.EnumItem;
import ca.uottawa.csmlab.symboleo.symboleo.Enumeration;
import ca.uottawa.csmlab.symboleo.symboleo.Model;
import ca.uottawa.csmlab.symboleo.symboleo.Obligation;
import ca.uottawa.csmlab.symboleo.symboleo.Parameter;
import ca.uottawa.csmlab.symboleo.symboleo.Power;
import ca.uottawa.csmlab.symboleo.symboleo.RegularType;
import ca.uottawa.csmlab.symboleo.symboleo.Rule;
import ca.uottawa.csmlab.symboleo.symboleo.Variable;
import org.eclipse.emf.ecore.EObject;
import org.eclipse.emf.ecore.EStructuralFeature;
import org.eclipse.lsp4j.SemanticTokenModifiers;
import org.eclipse.lsp4j.SemanticTokenTypes;
import org.eclipse.xtext.CrossReference;
import org.eclipse.xtext.ide.editor.syntaxcoloring.DefaultSemanticHighlightingCalculator;
import org.eclipse.xtext.ide.editor.syntaxcoloring.IHighlightedPositionAcceptor;
import org.eclipse.xtext.nodemodel.ILeafNode;
import org.eclipse.xtext.nodemodel.INode;
import org.eclipse.xtext.nodemodel.util.NodeModelUtils;
import org.eclipse.xtext.parser.IParseResult;
import org.eclipse.xtext.resource.XtextResource;
import org.eclipse.xtext.util.CancelIndicator;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Semantic tokens for SymboleoAC (LSP {@code textDocument/semanticTokens/full}).
 *
 * Declarations are classified by what they are in the contract ontology, and
 * every identifier that refers to a declaration receives the same token type,
 * so roles, events, assets, norms and rules are distinguishable in the editor
 * beyond keyword colouring:
 * <ul>
 * <li>domain types → {@code class}; enumerations → {@code enum}, their values → {@code enumMember}</li>
 * <li>attributes (in the domain and after ".") → {@code property}</li>
 * <li>contract parameters → {@code parameter}</li>
 * <li>declared event instances → {@code event}; other declared instances (roles, assets,
 *     data transfers) → {@code variable}</li>
 * <li>obligations and powers → {@code function}; access-control rules → {@code macro}</li>
 * </ul>
 * Declaration sites carry the {@code declaration} modifier. Plain-identifier
 * references are resolved by name ({@link SymboleoNames}); attribute and
 * {@code obligations.X} cross-references use the linked element.
 */
public class SymboleoHighlightingCalculator extends DefaultSemanticHighlightingCalculator {

    @Override
    protected void doProvideHighlightingFor(XtextResource resource, IHighlightedPositionAcceptor acceptor, CancelIndicator cancelIndicator) {
        if (resource.getContents().isEmpty() || !(resource.getContents().get(0) instanceof Model m)) return;
        Map<String, String> typeByName = new HashMap<>();

        // --- declarations (with the declaration modifier), remembering each name's token type
        for (Parameter p : m.getParameters()) declare(acceptor, typeByName, p, SemanticTokenTypes.Parameter);
        for (DomainType dt : m.getDomainTypes()) {
            if (dt instanceof Enumeration en) {
                declare(acceptor, typeByName, en, SemanticTokenTypes.Enum);
                for (EnumItem it : en.getEnumerationItems()) declare(acceptor, typeByName, it, SemanticTokenTypes.EnumMember);
            } else {
                declare(acceptor, typeByName, dt, SemanticTokenTypes.Class);
                if (dt instanceof RegularType rt) for (Attribute a : rt.getAttributes()) nameToken(acceptor, a, SemanticTokenTypes.Property, SemanticTokenModifiers.Declaration);
            }
        }
        for (Variable v : m.getVariables()) {
            String cat = v.getType() == null || v.getType().eIsProxy() ? "" : SymboleoNames.category(v.getType());
            declare(acceptor, typeByName, v, "Event".equals(cat) ? SemanticTokenTypes.Event : SemanticTokenTypes.Variable);
        }
        for (Obligation o : m.getObligations()) declare(acceptor, typeByName, o, SemanticTokenTypes.Function);
        for (Obligation o : m.getSurvivingObligations()) declare(acceptor, typeByName, o, SemanticTokenTypes.Function);
        for (Power p : m.getPowers()) declare(acceptor, typeByName, p, SemanticTokenTypes.Function);
        for (Rule r : m.getRules()) declare(acceptor, typeByName, r, SemanticTokenTypes.Macro);

        // --- references: every identifier token that is not a declaration site
        IParseResult pr = resource.getParseResult();
        if (pr == null) return;
        for (INode n : pr.getRootNode().getAsTreeIterable()) {
            if (cancelIndicator.isCanceled()) return;
            if (!(n instanceof ILeafNode leaf) || !SymboleoNames.isIdentifier(leaf)) continue;
            if (isDeclarationName(leaf)) continue;
            if (leaf.getGrammarElement() instanceof CrossReference) {
                // linked element: attribute after ".", obligations.X, powers.X, type references
                EObject target = NodeModelUtils.findActualSemanticObjectFor(leaf);
                String type = crossRefType(leaf, target);
                if (type != null) acceptor.addPosition(leaf.getOffset(), leaf.getLength(), type);
                continue;
            }
            if (SymboleoNames.afterDot(leaf)) {
                acceptor.addPosition(leaf.getOffset(), leaf.getLength(), SemanticTokenTypes.Property);
                continue;
            }
            String type = typeByName.get(leaf.getText());
            if (type != null) acceptor.addPosition(leaf.getOffset(), leaf.getLength(), type);
        }
    }

    private static void declare(IHighlightedPositionAcceptor acceptor, Map<String, String> typeByName, EObject decl, String type) {
        Object name = decl.eGet(decl.eClass().getEStructuralFeature("name"));
        if (name instanceof String s && !s.isEmpty()) typeByName.putIfAbsent(s, type);
        nameToken(acceptor, decl, type, SemanticTokenModifiers.Declaration);
    }

    private static void nameToken(IHighlightedPositionAcceptor acceptor, EObject decl, String type, String... modifiers) {
        EStructuralFeature f = decl.eClass().getEStructuralFeature("name");
        if (f == null) return;
        List<INode> nodes = NodeModelUtils.findNodesForFeature(decl, f);
        for (INode n : nodes) {
            String[] styles = new String[modifiers.length + 1];
            styles[0] = type;
            System.arraycopy(modifiers, 0, styles, 1, modifiers.length);
            acceptor.addPosition(n.getOffset(), n.getLength(), styles);
        }
    }

    /** True when this leaf is the "name" feature value of its semantic element (already highlighted). */
    private static boolean isDeclarationName(ILeafNode leaf) {
        EObject owner = NodeModelUtils.findActualSemanticObjectFor(leaf);
        if (owner == null) return false;
        EStructuralFeature f = owner.eClass().getEStructuralFeature("name");
        if (f == null) return false;
        for (INode n : NodeModelUtils.findNodesForFeature(owner, f)) if (n.getOffset() == leaf.getOffset()) return true;
        return false;
    }

    /** Token type from the cross-reference's declared target type in the grammar. */
    private static String crossRefType(ILeafNode leaf, EObject target) {
        String typeName = null;
        if (leaf.getGrammarElement() instanceof CrossReference cr && cr.getType() != null && cr.getType().getClassifier() != null) {
            typeName = cr.getType().getClassifier().getName();
        }
        if (typeName == null && target != null) typeName = target.eClass().getName();
        if (typeName == null) return null;
        switch (typeName) {
            case "Attribute": return SemanticTokenTypes.Property;
            case "Obligation": case "Power": return SemanticTokenTypes.Function;
            case "Enumeration": return SemanticTokenTypes.Enum;
            case "EnumItem": return SemanticTokenTypes.EnumMember;
            case "RegularType": case "DomainType": case "Alias": return SemanticTokenTypes.Class;
            default: return null;
        }
    }
}
