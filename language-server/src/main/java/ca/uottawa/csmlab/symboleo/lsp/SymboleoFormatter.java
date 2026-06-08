package ca.uottawa.csmlab.symboleo.lsp;

import ca.uottawa.csmlab.symboleo.symboleo.Model;
import ca.uottawa.csmlab.symboleo.symboleo.Obligation;
import ca.uottawa.csmlab.symboleo.symboleo.PAnd;
import ca.uottawa.csmlab.symboleo.symboleo.PAtomRecursive;
import ca.uottawa.csmlab.symboleo.symboleo.POr;
import ca.uottawa.csmlab.symboleo.symboleo.Power;
import org.eclipse.emf.ecore.EObject;
import org.eclipse.xtext.formatting2.AbstractFormatter2;
import org.eclipse.xtext.formatting2.IFormattableDocument;
import org.eclipse.xtext.formatting2.regionaccess.ISemanticRegion;
import org.eclipse.xtext.formatting2.regionaccess.ISemanticRegionsFinder;
import org.eclipse.xtext.resource.XtextResource;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/**
 * Document formatter for SymboleoAC. Hand-written in Java (the Maven build
 * doesn't run the Xtend compiler), so we implement the {@code format(Object,…)}
 * dispatch ourselves. Indentation width follows the LSP request options (Monaco
 * sends tabSize=3, insertSpaces=true) so {@code indent()} renders 3 spaces.
 *
 * Layout:
 *   • Sections flush-left; members one per line, indented; blank-line runs
 *     collapse to at most one.
 *   • Obligations/Powers:
 *         label: trigger -> O(debtor, creditor,
 *            antecedent…              (param 3, broken on its top-level and/or)
 *            consequent…              (param 4, broken on its top-level and/or)
 *         ) with Controller …;
 *     The first two parameters stay on the header line; the antecedent and
 *     consequent each start on their own line and split across lines on their
 *     TOP-LEVEL boolean operators (those not inside parentheses).
 *   • Argument expressions are fully re-flowed: the author's stray whitespace
 *     and line breaks are normalised (consistent operator/paren/comma spacing)
 *     before the chosen breaks are applied. Only whitespace ever changes.
 */
public class SymboleoFormatter extends AbstractFormatter2 {

  private static final String[] SECTION_BOUNDARIES = {
      "Declarations", "Preconditions", "Postconditions", "Obligations",
      "Surviving", "Powers", "ACPolicy", "Constraints", "endContract",
  };

  private static final Set<String> OPERATORS = Set.of(
      "and", "or", "not", "==", "!=", ">=", "<=", ">", "<",
      "+", "-", "*", "/", "%", ":=", "=", "->");

  @Override
  public void format(Object obj, IFormattableDocument doc) {
    if (obj instanceof XtextResource) {
      XtextResource res = (XtextResource) obj;
      if (!res.getContents().isEmpty()) {
        doc.format(res.getContents().get(0));
      }
    } else if (obj instanceof Model) {
      formatModel((Model) obj, doc);
    } else if (obj instanceof Obligation || obj instanceof Power) {
      formatNorm((EObject) obj, doc);
    }
  }

  private void formatModel(Model m, IFormattableDocument doc) {
    ISemanticRegionsFinder mf = textRegionExtensions.regionFor(m);

    ISemanticRegion domainKw = mf.keyword("Domain");
    ISemanticRegion endDomainKw = mf.keyword("endDomain");
    if (domainKw != null && endDomainKw != null) {
      doc.interior(domainKw, endDomainKw, f -> f.indent());
    }

    List<ISemanticRegion> bounds = new ArrayList<>();
    for (String kw : SECTION_BOUNDARIES) {
      bounds.addAll(mf.keywords(kw));
    }
    bounds.sort(Comparator.comparingInt(ISemanticRegion::getOffset));
    for (int i = 0; i + 1 < bounds.size(); i++) {
      doc.interior(bounds.get(i), bounds.get(i + 1), f -> f.indent());
    }

    if (endDomainKw != null) doc.prepend(endDomainKw, f -> f.setNewLines(1, 1, 2));
    ISemanticRegion contractKw = mf.keyword("Contract");
    if (contractKw != null) doc.prepend(contractKw, f -> f.setNewLines(1, 1, 2));
    for (ISemanticRegion b : bounds) {
      doc.prepend(b, f -> f.setNewLines(1, 1, 2));
    }
    // Trim trailing blank lines: exactly one newline at end of file.
    ISemanticRegion endContractKw = mf.keyword("endContract");
    if (endContractKw != null) doc.append(endContractKw, f -> f.setNewLines(1, 1, 1));

    onePerLine(doc, m.getDomainTypes());
    onePerLine(doc, m.getVariables());
    onePerLine(doc, m.getPreconditions());
    onePerLine(doc, m.getPostconditions());
    onePerLine(doc, m.getObligations());
    onePerLine(doc, m.getSurvivingObligations());
    onePerLine(doc, m.getPowers());
    onePerLine(doc, m.getRules());
    onePerLine(doc, m.getConstraints());

    for (Obligation o : m.getObligations()) doc.format(o);
    for (Obligation o : m.getSurvivingObligations()) doc.format(o);
    for (Power p : m.getPowers()) doc.format(p);
  }

  private void onePerLine(IFormattableDocument doc, List<? extends EObject> elements) {
    for (EObject e : elements) {
      doc.prepend(e, f -> f.setNewLines(1, 1, 2));
    }
  }

  private void formatNorm(EObject norm, IFormattableDocument doc) {
    ISemanticRegionsFinder f = textRegionExtensions.regionFor(norm);
    ISemanticRegion open = f.keyword("(");
    ISemanticRegion close = f.keyword(")");
    List<ISemanticRegion> commas = f.keywords(",");

    if (open != null && close != null) {
      doc.append(open, h -> h.noSpace());           // '(' debtor — tight
      doc.interior(open, close, h -> h.indent());   // arguments one level in
      doc.prepend(close, h -> h.newLine());          // ')' on its own line
    }
    for (int i = 0; i < commas.size(); i++) {
      ISemanticRegion comma = commas.get(i);
      doc.prepend(comma, h -> h.noSpace());
      if (i == 0) {
        doc.append(comma, h -> h.oneSpace());        // debtor, creditor share line 1
      } else {
        doc.append(comma, h -> h.newLine());         // antecedent / consequent: own lines
      }
    }
    ISemanticRegion arrow = f.keyword("->");          // trigger arrow
    if (arrow != null) {
      doc.prepend(arrow, h -> h.oneSpace());
      doc.append(arrow, h -> h.oneSpace());
    }

    if (norm instanceof Obligation) {
      Obligation o = (Obligation) norm;
      reflow(o.getTrigger(), true, doc);              // trigger stays inline but re-flowed
      reflow(o.getAntecedent(), false, doc);          // param 3: break on top-level and/or
      reflow(o.getConsequent(), false, doc);          // param 4: break on top-level and/or
    } else if (norm instanceof Power) {
      Power p = (Power) norm;
      reflow(p.getTrigger(), true, doc);
      reflow(p.getAntecedent(), false, doc);
      reflow(p.getConsequent(), true, doc);           // PowerFunction: re-flow only, no break
    }
  }

  /**
   * Normalise all whitespace inside an argument expression (collapsing the
   * author's stray newlines/spacing to canonical spacing), then break its
   * top-level boolean operators onto their own indented lines.
   *
   * @param keepInline when true, never break (just re-flow onto one line) —
   *                   used for the trigger and for non-proposition consequents.
   */
  private void reflow(EObject arg, boolean keepInline, IFormattableDocument doc) {
    if (arg == null) return;

    Set<ISemanticRegion> breaks = new HashSet<>();
    if (!keepInline) {
      List<EObject> nodes = new ArrayList<>();
      nodes.add(arg);
      for (Iterator<EObject> it = arg.eAllContents(); it.hasNext();) {
        nodes.add(it.next());
      }
      for (EObject n : nodes) {
        String op = (n instanceof POr) ? "or" : (n instanceof PAnd) ? "and" : null;
        if (op == null || !isTopLevel(n, arg)) continue;
        ISemanticRegion kw = textRegionExtensions.regionFor(n).keyword(op);
        if (kw != null) breaks.add(kw);
      }
    }

    ISemanticRegion prev = null;
    for (ISemanticRegion r : textRegionExtensions.allSemanticRegions(arg)) {
      if (prev != null) {
        final ISemanticRegion left = prev;
        if (breaks.contains(r)) {
          doc.append(left, h -> h.newLine());
        } else if (needSpace(left.getText(), r.getText())) {
          doc.append(left, h -> h.oneSpace());
        } else {
          doc.append(left, h -> h.noSpace());
        }
      }
      prev = r;
    }

    if (!breaks.isEmpty()) {
      doc.interior(arg, h -> h.indent());
    }
  }

  /** Canonical spacing between two adjacent tokens of an expression. */
  private boolean needSpace(String l, String r) {
    if (r.equals(",") || r.equals(";")) return false;   // no space before , ;
    if (r.equals(")")) return false;                     // no space before )
    if (l.equals("(")) return false;                     // no space after (
    if (l.endsWith(".") || r.equals(".")) return false;  // no space around . (incl. 'obligations.'/'powers.')
    if (l.equals(",") || l.equals(";")) return true;     // one space after , ;
    if (r.equals("(")) return OPERATORS.contains(l);     // fn-call: tight; after op: spaced
    return true;                                          // default: one space
  }

  /** True when no parenthesised sub-proposition sits between {@code node} and
   *  {@code root}. */
  private boolean isTopLevel(EObject node, EObject root) {
    for (EObject p = node.eContainer(); p != null && p != root; p = p.eContainer()) {
      if (p instanceof PAtomRecursive) return false;
    }
    return true;
  }
}
