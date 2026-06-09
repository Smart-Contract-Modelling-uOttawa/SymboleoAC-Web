package ca.uottawa.csmlab.symboleo.codegen;

import ca.uottawa.csmlab.symboleo.symboleo.ACPolicy;
import ca.uottawa.csmlab.symboleo.symboleo.Alias;
import ca.uottawa.csmlab.symboleo.symboleo.Attribute;
import ca.uottawa.csmlab.symboleo.symboleo.Controller;
import ca.uottawa.csmlab.symboleo.symboleo.DomainType;
import ca.uottawa.csmlab.symboleo.symboleo.EnumItem;
import ca.uottawa.csmlab.symboleo.symboleo.Enumeration;
import ca.uottawa.csmlab.symboleo.symboleo.Model;
import ca.uottawa.csmlab.symboleo.symboleo.Obligation;
import ca.uottawa.csmlab.symboleo.symboleo.OntologyType;
import ca.uottawa.csmlab.symboleo.symboleo.Power;
import ca.uottawa.csmlab.symboleo.symboleo.RegularType;
import ca.uottawa.csmlab.symboleo.symboleo.Rule;
import ca.uottawa.csmlab.symboleo.symboleo.Variable;
import org.eclipse.emf.ecore.EObject;
import org.eclipse.xtext.Keyword;
import org.eclipse.xtext.nodemodel.ICompositeNode;
import org.eclipse.xtext.nodemodel.ILeafNode;
import org.eclipse.xtext.nodemodel.INode;
import org.eclipse.xtext.nodemodel.util.NodeModelUtils;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Extracts a structured, navigable summary of a SymboleoAC contract for the
 * web IDE's Outline, model diagram, and access-control matrix. Best-effort:
 * works even when the contract has validation errors, so the outline stays
 * useful while editing.
 */
final class ModelJson {

  private static final Set<String> SECTION_KW = Set.of(
      "Domain", "endDomain", "Contract", "Declarations", "Preconditions",
      "Postconditions", "Obligations", "Surviving", "Powers", "ACPolicy", "Constraints");

  static JSONObject build(Model m, String source) {
    JSONObject root = new JSONObject();
    root.put("domainName", nz(m.getDomainName()));
    root.put("contractName", nz(m.getContractName()));

    // --- domain types, classified by resolving the inheritance chain ---
    // category -> [ {name,line,col} ], insertion-ordered for stable display.
    Map<String, JSONArray> cats = new LinkedHashMap<>();
    for (DomainType dt : m.getDomainTypes()) {
      if (dt == null) continue;
      String cat = classify(dt, 0);
      cats.computeIfAbsent(cat, k -> new JSONArray()).put(named(dt.getName(), dt, source));
    }
    JSONObject domainCats = new JSONObject();
    for (Map.Entry<String, JSONArray> e : cats.entrySet()) domainCats.put(e.getKey(), e.getValue());
    root.put("domainCategories", domainCats);

    // --- declared variables, classified by their (inheritance-resolved) type ---
    Map<String, JSONArray> vcats = new LinkedHashMap<>();
    for (Variable v : m.getVariables()) {
      RegularType t = v.getType();
      String cat = (t != null && !t.eIsProxy()) ? classify(t, 0) : "Other";
      vcats.computeIfAbsent(cat, k -> new JSONArray()).put(named(v.getName(), v, source));
    }
    JSONObject varCats = new JSONObject();
    for (Map.Entry<String, JSONArray> e : vcats.entrySet()) varCats.put(e.getKey(), e.getValue());
    root.put("variableCategories", varCats);

    // --- domain class model (for the class diagram) ---
    root.put("domainModel", domainModel(m, source));

    // --- section keyword positions (only those present) ---
    root.put("keywords", keywordPositions(m, source));

    // --- named members ---
    root.put("variables", names(m.getVariables(), source));
    root.put("obligations", norms(m.getObligations(), source, false));
    root.put("survivingObligations", norms(m.getSurvivingObligations(), source, false));
    root.put("powers", norms(m.getPowers(), source, true));
    root.put("rules", rules(m.getRules(), source));

    JSONArray acCtrl = new JSONArray();
    ACPolicy ac = m.getAcpolicys();
    if (ac != null) {
      for (Controller c : ac.getController()) acCtrl.put(text(c.getControllerType()));
    }
    root.put("acControllers", acCtrl);

    root.put("counts", new JSONObject()
        .put("preconditions", m.getPreconditions().size())
        .put("postconditions", m.getPostconditions().size())
        .put("constraints", m.getConstraints().size()));
    return root;
  }

  /** Resolve a domain type to a display category, following single inheritance. */
  private static String classify(DomainType dt, int depth) {
    if (dt instanceof Enumeration) return "Enumerations";
    if (dt instanceof Alias) return "Aliases";
    if (dt instanceof RegularType rt) {
      if (depth > 16) return "Other";
      OntologyType ot = rt.getOntologyType();
      if (ot != null) return ontology(ot.getName());
      if (rt.getAResource() != null) return "Resources";
      RegularType parent = rt.getRegularType();
      if (parent != null && !parent.eIsProxy()) return classify(parent, depth + 1);
      return "Other";
    }
    return "Other";
  }

  /** Per-type structure for the class diagram: parent (inheritance), thirdParty,
   *  attributes (base-typed members vs domain-typed associations), and enums. */
  private static JSONObject domainModel(Model m, String source) {
    JSONArray types = new JSONArray();
    JSONArray enums = new JSONArray();
    for (DomainType dt : m.getDomainTypes()) {
      if (dt instanceof Enumeration en) {
        JSONObject e = named(en.getName(), en, source);
        JSONArray items = new JSONArray();
        for (EnumItem it : en.getEnumerationItems()) items.put(nz(it.getName()));
        e.put("items", items);
        enums.put(e);
      } else if (dt instanceof RegularType rt) {
        JSONObject t = named(rt.getName(), rt, source);
        String parent = null;
        boolean parentIsBase = false;
        OntologyType ot = rt.getOntologyType();
        if (ot != null) { parent = ot.getName(); parentIsBase = true; }
        else if (rt.getAResource() != null) { parent = "Resource"; parentIsBase = true; }
        else {
          RegularType p = rt.getRegularType();
          if (p != null && !p.eIsProxy()) { parent = p.getName(); parentIsBase = false; }
        }
        t.put("parent", parent == null ? JSONObject.NULL : parent);
        t.put("parentIsBase", parentIsBase);
        t.put("category", classify(rt, 0)); // inheritance-resolved, for diagram colouring
        t.put("thirdParty", rt.getThirdParty() != null);
        JSONArray attrs = new JSONArray();
        for (Attribute a : rt.getAttributes()) {
          JSONObject ja = new JSONObject();
          ja.put("name", nz(a.getName()));
          ja.put("modifier", a.getAttributeModifier() != null ? nz(a.getAttributeModifier().getName()) : "");
          if (a.getBaseType() != null) {
            ja.put("type", nz(a.getBaseType().getName()));
            ja.put("ref", false);
          } else if (a.getDomainType() != null && !a.getDomainType().eIsProxy()) {
            ja.put("type", nz(a.getDomainType().getName()));
            ja.put("ref", true);
          } else {
            ja.put("type", "");
            ja.put("ref", false);
          }
          attrs.put(ja);
        }
        t.put("attributes", attrs);
        types.put(t);
      }
    }
    return new JSONObject().put("types", types).put("enums", enums);
  }

  private static String ontology(String name) {
    if (name == null) return "Other";
    switch (name) {
      case "Asset": return "Assets";
      case "Event": return "Events";
      case "Role": return "Roles";
      case "DataTransfer": return "Data Transfers";
      case "Contract": return "Contracts";
      default: return "Other";
    }
  }

  private static JSONObject keywordPositions(Model m, String source) {
    JSONObject out = new JSONObject();
    INode node = NodeModelUtils.getNode(m);
    if (node == null) return out;
    ICompositeNode rootNode = node.getRootNode();
    for (INode n : rootNode.getAsTreeIterable()) {
      if (n instanceof ILeafNode leaf && !leaf.isHidden()
          && leaf.getGrammarElement() instanceof Keyword kw) {
        String v = kw.getValue();
        if (SECTION_KW.contains(v) && !out.has(v)) {
          out.put(v, pos(n.getOffset(), source));
        }
      }
    }
    return out;
  }

  private static JSONArray names(List<? extends EObject> elems, String source) {
    JSONArray arr = new JSONArray();
    for (EObject e : elems) arr.put(named(nameOf(e), e, source));
    return arr;
  }

  private static JSONArray norms(List<? extends EObject> norms, String source, boolean power) {
    JSONArray arr = new JSONArray();
    for (EObject e : norms) {
      JSONObject o = named(nameOf(e), e, source);
      if (e instanceof Obligation ob) {
        o.put("debtor", text(ob.getDebtor()));
        o.put("creditor", text(ob.getCreditor()));
        o.put("controller", text(ob.getController()));
        o.put("hasTrigger", ob.getTrigger() != null);
      } else if (e instanceof Power p) {
        o.put("creditor", text(p.getCreditor()));
        o.put("debtor", text(p.getDebtor()));
        o.put("controller", text(p.getController()));
        o.put("hasTrigger", p.getTrigger() != null);
      }
      arr.put(o);
    }
    return arr;
  }

  private static JSONArray rules(List<Rule> rules, String source) {
    JSONArray arr = new JSONArray();
    for (Rule r : rules) {
      JSONObject o = named(nz(r.getName()), r, source);
      o.put("action", nz(r.getAction()));
      o.put("permission", r.getPermission() != null ? nz(r.getPermission().getName()) : "");
      o.put("role", text(r.getAccessedRole()));
      o.put("resource", text(r.getAccessedResource()));
      o.put("controller", text(r.getController()));
      arr.put(o);
    }
    return arr;
  }

  // --- helpers ---

  private static String nameOf(EObject e) {
    try { return nz((String) e.getClass().getMethod("getName").invoke(e)); }
    catch (Exception ex) { return ""; }
  }

  private static JSONObject named(String name, EObject e, String source) {
    JSONObject o = new JSONObject();
    o.put("name", nz(name));
    INode n = NodeModelUtils.getNode(e);
    JSONObject p = pos(n != null ? n.getOffset() : 0, source);
    o.put("line", p.getInt("line"));
    o.put("col", p.getInt("col"));
    return o;
  }

  /** Trimmed, whitespace-collapsed source text of a node (e.g. "obligations.payment"). */
  private static String text(EObject e) {
    if (e == null) return "";
    INode n = NodeModelUtils.getNode(e);
    if (n == null) return "";
    return n.getText().trim().replaceAll("\\s+", " ");
  }

  private static JSONObject pos(int offset, String src) {
    int line = 1, col = 1;
    int max = Math.min(offset, src.length());
    for (int i = 0; i < max; i++) {
      if (src.charAt(i) == '\n') { line++; col = 1; } else { col++; }
    }
    return new JSONObject().put("line", line).put("col", col);
  }

  private static String nz(String s) { return s == null ? "" : s; }

  private ModelJson() {}
}
