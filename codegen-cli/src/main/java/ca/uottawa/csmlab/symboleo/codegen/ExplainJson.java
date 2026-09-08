package ca.uottawa.csmlab.symboleo.codegen;

import ca.uottawa.csmlab.symboleo.symboleo.ACPolicy;
import ca.uottawa.csmlab.symboleo.symboleo.AssignExpression;
import ca.uottawa.csmlab.symboleo.symboleo.Assignment;
import ca.uottawa.csmlab.symboleo.symboleo.Attribute;
import ca.uottawa.csmlab.symboleo.symboleo.ContractEvent;
import ca.uottawa.csmlab.symboleo.symboleo.ContractState;
import ca.uottawa.csmlab.symboleo.symboleo.Controller;
import ca.uottawa.csmlab.symboleo.symboleo.DataTransfer;
import ca.uottawa.csmlab.symboleo.symboleo.DomainType;
import ca.uottawa.csmlab.symboleo.symboleo.Enumeration;
import ca.uottawa.csmlab.symboleo.symboleo.Event;
import ca.uottawa.csmlab.symboleo.symboleo.Expression;
import ca.uottawa.csmlab.symboleo.symboleo.Interval;
import ca.uottawa.csmlab.symboleo.symboleo.IntervalExpression;
import ca.uottawa.csmlab.symboleo.symboleo.IntervalFunction;
import ca.uottawa.csmlab.symboleo.symboleo.Model;
import ca.uottawa.csmlab.symboleo.symboleo.OAssignExpression;
import ca.uottawa.csmlab.symboleo.symboleo.OAssignment;
import ca.uottawa.csmlab.symboleo.symboleo.Obligation;
import ca.uottawa.csmlab.symboleo.symboleo.ObligationEvent;
import ca.uottawa.csmlab.symboleo.symboleo.ObligationState;
import ca.uottawa.csmlab.symboleo.symboleo.OntologyType;
import ca.uottawa.csmlab.symboleo.symboleo.Parameter;
import ca.uottawa.csmlab.symboleo.symboleo.Point;
import ca.uottawa.csmlab.symboleo.symboleo.PointAtomContractEvent;
import ca.uottawa.csmlab.symboleo.symboleo.PointAtomObligationEvent;
import ca.uottawa.csmlab.symboleo.symboleo.PointAtomParameterDotExpression;
import ca.uottawa.csmlab.symboleo.symboleo.PointAtomPowerEvent;
import ca.uottawa.csmlab.symboleo.symboleo.PointExpression;
import ca.uottawa.csmlab.symboleo.symboleo.PointFunction;
import ca.uottawa.csmlab.symboleo.symboleo.Power;
import ca.uottawa.csmlab.symboleo.symboleo.PowerEvent;
import ca.uottawa.csmlab.symboleo.symboleo.PowerFunction;
import ca.uottawa.csmlab.symboleo.symboleo.PowerState;
import ca.uottawa.csmlab.symboleo.symboleo.Proposition;
import ca.uottawa.csmlab.symboleo.symboleo.Ref;
import ca.uottawa.csmlab.symboleo.symboleo.RegularType;
import ca.uottawa.csmlab.symboleo.symboleo.Rule;
import ca.uottawa.csmlab.symboleo.symboleo.Situation;
import ca.uottawa.csmlab.symboleo.symboleo.SituationExpression;
import ca.uottawa.csmlab.symboleo.symboleo.Timevalue;
import ca.uottawa.csmlab.symboleo.symboleo.TimevalueInt;
import ca.uottawa.csmlab.symboleo.symboleo.TimevalueVariable;
import ca.uottawa.csmlab.symboleo.symboleo.Variable;
import ca.uottawa.csmlab.symboleo.symboleo.VariableDotExpression;
import ca.uottawa.csmlab.symboleo.symboleo.VariableEvent;
import ca.uottawa.csmlab.symboleo.symboleo.VariableRef;
import org.eclipse.emf.ecore.EObject;
import org.eclipse.emf.ecore.EStructuralFeature;
import org.eclipse.xtext.nodemodel.INode;
import org.eclipse.xtext.nodemodel.util.NodeModelUtils;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Structured explanation model ("IR") for the web IDE's Explain tab.
 *
 * Emits, for every obligation / surviving obligation / power, a resolved,
 * language-independent description: parties (with their declared type and
 * third-party flag), trigger / antecedent / consequent as a small JSON AST in
 * which every event or variable reference is resolved against the
 * Declarations and Domain, cross-references between norms (dependsOn / feeds),
 * the resources a norm reads or writes, the access-control rules that touch
 * them, and the specifier's comment immediately above the norm ("authorNote").
 * The contract-level part carries parameters, parties, preconditions,
 * postconditions, constraints, sensors, assets and a few derived observations.
 *
 * Wording is deliberately NOT produced here: the browser renders this model in
 * the user's chosen style. Everything is best-effort (unresolved references
 * become {"unresolved": "..."}), so the output is usable while editing; the
 * caller reports validation errors separately and the UI gates on them.
 */
final class ExplainJson {

  private final Model model;
  private final String source;
  private final Map<String, Variable> vars = new LinkedHashMap<>();
  private final Map<String, Parameter> params = new LinkedHashMap<>();
  private final Map<String, String> normKind = new LinkedHashMap<>(); // name -> obligation|survivingObligation|power
  /** norm name -> names of norms it references (via events / situations / power effects). */
  private final Map<String, Set<String>> dependsOn = new LinkedHashMap<>();
  /** norm name -> resource references it reads/writes ("delivered", "vaccineDose.FDAapproval"). */
  private final Map<String, Set<String>> touches = new LinkedHashMap<>();
  private String current; // norm being converted, for dependsOn/touches bookkeeping

  private ExplainJson(Model m, String source) {
    this.model = m;
    this.source = source;
    for (Variable v : m.getVariables()) if (v.getName() != null) vars.put(v.getName(), v);
    for (Parameter p : m.getParameters()) if (p.getName() != null) params.put(p.getName(), p);
    for (Obligation o : m.getObligations()) if (o.getName() != null) normKind.put(o.getName(), "obligation");
    for (Obligation o : m.getSurvivingObligations()) if (o.getName() != null) normKind.put(o.getName(), "survivingObligation");
    for (Power p : m.getPowers()) if (p.getName() != null) normKind.put(p.getName(), "power");
  }

  static JSONObject build(Model m, String source) {
    return new ExplainJson(m, source).run();
  }

  private JSONObject run() {
    JSONArray norms = new JSONArray();
    for (Obligation o : model.getObligations()) norms.put(obligation(o, "obligation"));
    for (Obligation o : model.getSurvivingObligations()) norms.put(obligation(o, "survivingObligation"));
    for (Power p : model.getPowers()) norms.put(power(p));

    // feeds = inverse of dependsOn; acRules = rules whose resource is touched.
    Map<String, Set<String>> feeds = new LinkedHashMap<>();
    for (Map.Entry<String, Set<String>> e : dependsOn.entrySet())
      for (String dep : e.getValue()) feeds.computeIfAbsent(dep, k -> new LinkedHashSet<>()).add(e.getKey());
    for (int i = 0; i < norms.length(); i++) {
      JSONObject n = norms.getJSONObject(i);
      String name = n.getString("name");
      n.put("dependsOn", new JSONArray(dependsOn.getOrDefault(name, Set.of())));
      n.put("feeds", new JSONArray(feeds.getOrDefault(name, Set.of())));
      n.put("touches", new JSONArray(touches.getOrDefault(name, Set.of())));
      n.put("acRules", new JSONArray(rulesTouching(name, touches.getOrDefault(name, Set.of()))));
    }

    JSONObject root = new JSONObject();
    root.put("norms", norms);
    root.put("contract", contract());
    return root;
  }

  // ---------------------------------------------------------------- norms

  private JSONObject obligation(Obligation o, String kind) {
    current = nz(o.getName());
    JSONObject n = header(o, kind);
    n.put("debtor", party(o.getDebtor()));
    n.put("creditor", party(o.getCreditor()));
    n.put("controller", o.getController() == null ? JSONObject.NULL : party(o.getController()));
    n.put("trigger", o.getTrigger() == null ? JSONObject.NULL : prop(o.getTrigger()));
    n.put("antecedent", prop(o.getAntecedent()));
    n.put("consequent", prop(o.getConsequent()));
    return n;
  }

  private JSONObject power(Power p) {
    current = nz(p.getName());
    JSONObject n = header(p, "power");
    n.put("creditor", party(p.getCreditor())); // holder of the power
    n.put("debtor", party(p.getDebtor()));
    n.put("controller", p.getController() == null ? JSONObject.NULL : party(p.getController()));
    n.put("trigger", p.getTrigger() == null ? JSONObject.NULL : prop(p.getTrigger()));
    n.put("antecedent", prop(p.getAntecedent()));
    n.put("consequent", powerEffect(p.getConsequent()));
    return n;
  }

  private JSONObject header(EObject e, String kind) {
    JSONObject n = new JSONObject();
    n.put("kind", kind);
    n.put("name", nz(nameOf(e)));
    JSONObject p = pos(e);
    n.put("line", p.getInt("line"));
    n.put("col", p.getInt("col"));
    String note = authorNote(e);
    n.put("authorNote", note == null ? JSONObject.NULL : note);
    return n;
  }

  private JSONObject powerEffect(PowerFunction pf) {
    JSONObject j = new JSONObject();
    if (pf == null) return j.put("t", "unresolved").put("text", "");
    j.put("t", "effect");
    j.put("action", nz(pf.getAction()));
    Object norm = feat(pf, "norm");
    if (norm instanceof Obligation ob) {
      j.put("target", "obligation").put("norm", nz(ob.getName()));
      dep(ob.getName());
    } else if (norm instanceof Power pw) {
      j.put("target", "power").put("norm", nz(pw.getName()));
      dep(pw.getName());
    } else {
      j.put("target", "contract");
    }
    return j;
  }

  /** {var,type,category,thirdParty,fromParam,unresolved?} for a debtor/creditor/controller. */
  private JSONObject party(Ref r) {
    JSONObject j = new JSONObject();
    String text = text(r);
    j.put("ref", text);
    String root = rootVar(r);
    j.put("var", nz(root));
    Variable v = root == null ? null : vars.get(root);
    if (v != null && v.getType() != null && !v.getType().eIsProxy()) {
      RegularType t = v.getType();
      j.put("type", nz(t.getName()));
      j.put("category", categoryOf(t));
      j.put("thirdParty", isThirdParty(t, 0));
      String fp = fromParam(v);
      j.put("fromParam", fp == null ? JSONObject.NULL : fp);
    } else if (root != null && params.containsKey(root)) {
      Parameter p = params.get(root);
      j.put("type", paramTypeName(p));
      j.put("category", "Parameter");
      j.put("thirdParty", false);
      j.put("fromParam", root);
    } else {
      j.put("unresolved", true);
    }
    return j;
  }

  /** Name of the contract parameter a declared party is initialised from (name := xP.name). */
  private String fromParam(Variable v) {
    for (Assignment a : v.getAttributes()) {
      if (a instanceof AssignExpression ae) {
        String root = rootVarOfExpr(ae.getValue());
        if (root != null && params.containsKey(root)) return root;
      }
    }
    return null;
  }

  // --------------------------------------------------------- propositions

  private JSONObject prop(Proposition p) {
    if (p == null) return new JSONObject().put("t", "unresolved").put("text", "");
    String cls = p.eClass().getName();
    switch (cls) {
      case "POr": return nary("or", p);
      case "PAnd": return nary("and", p);
      case "PEquality":
      case "PComparison":
      case "PArithmetic": {
        JSONObject j = new JSONObject().put("t", cls.equals("PArithmetic") ? "arith" : "cmp");
        j.put("op", nz((String) feat(p, "op")));
        j.put("left", prop((Proposition) feat(p, "left")));
        j.put("right", prop((Proposition) feat(p, "right")));
        return j;
      }
      case "PAtomRecursive": return prop((Proposition) feat(p, "inner"));
      case "NegatedPAtom": return new JSONObject().put("t", "not").put("p", prop((Proposition) feat(p, "negated")));
      case "PAtomPredicate": return predicate((EObject) feat(p, "predicateFunction"));
      case "PAtomFunction": {
        EObject f = (EObject) feat(p, "function");
        JSONObject j = new JSONObject().put("t", "fn").put("name", f == null ? "" : nz((String) feat(f, "name")));
        JSONArray args = new JSONArray();
        if (f != null) for (String a : new String[] {"arg1", "arg2"}) {
          Object v = feat(f, a);
          if (v != null) args.put(String.valueOf(v));
        }
        return j.put("args", args);
      }
      case "PAtomEnum": {
        Enumeration en = (Enumeration) feat(p, "enumeration");
        EObject item = (EObject) feat(p, "enumItem");
        return new JSONObject().put("t", "enum").put("enum", en == null ? "" : nz(en.getName()))
            .put("item", item == null ? "" : nz(nameOf(item)));
      }
      case "PAtomVariable": return varRef((Ref) feat(p, "variable"));
      case "PAtomPredicateTrueLiteral": return lit("bool", true);
      case "PAtomPredicateFalseLiteral": return lit("bool", false);
      case "PAtomDoubleLiteral": return lit("number", feat(p, "value"));
      case "PAtomIntLiteral": return lit("number", feat(p, "value"));
      case "PAtomStringLiteral": return lit("string", feat(p, "value"));
      case "PAtomDateLiteral": return lit("date", String.valueOf(feat(p, "value")));
      default: return new JSONObject().put("t", "unresolved").put("text", text(p));
    }
  }

  /** Flatten left-nested binary and/or chains into one n-ary node. */
  private JSONObject nary(String op, Proposition p) {
    JSONArray items = new JSONArray();
    collect(op, p, items);
    return new JSONObject().put("t", op).put("items", items);
  }

  private void collect(String op, Proposition p, JSONArray into) {
    String want = op.equals("or") ? "POr" : "PAnd";
    if (p != null && p.eClass().getName().equals(want)) {
      collect(op, (Proposition) feat(p, "left"), into);
      collect(op, (Proposition) feat(p, "right"), into);
    } else if (p != null && p.eClass().getName().equals("PAtomRecursive")) {
      // (a and b) inside an and-chain: flatten too, parentheses carry no meaning for same-op chains.
      Proposition inner = (Proposition) feat(p, "inner");
      if (inner != null && inner.eClass().getName().equals(want)) collect(op, inner, into);
      else into.put(prop(p));
    } else {
      into.put(prop(p));
    }
  }

  private JSONObject predicate(EObject pf) {
    if (pf == null) return new JSONObject().put("t", "unresolved").put("text", "");
    String cls = pf.eClass().getName();
    switch (cls) {
      case "PredicateFunctionHappens":
        return new JSONObject().put("t", "happens").put("event", event((Event) feat(pf, "event")));
      case "PredicateFunctionWHappensBefore":
      case "PredicateFunctionSHappensBefore":
        return new JSONObject().put("t", "before").put("strict", cls.startsWith("PredicateFunctionS"))
            .put("event", event((Event) feat(pf, "event"))).put("point", point((Point) feat(pf, "point")));
      case "PredicateFunctionWHappensBeforeEvent":
      case "PredicateFunctionSHappensBeforeEvent":
        return new JSONObject().put("t", "beforeEvent").put("strict", cls.startsWith("PredicateFunctionS"))
            .put("event", event((Event) feat(pf, "event1"))).put("event2", event((Event) feat(pf, "event2")));
      case "PredicateFunctionHappensAfter":
        return new JSONObject().put("t", "after")
            .put("event", event((Event) feat(pf, "event"))).put("point", point((Point) feat(pf, "point")));
      case "PredicateFunctionHappensWithin":
        return new JSONObject().put("t", "within")
            .put("event", event((Event) feat(pf, "event"))).put("interval", interval((Interval) feat(pf, "interval")));
      case "PredicateFunctionOccurs":
        return new JSONObject().put("t", "occurs")
            .put("situation", situation((Situation) feat(pf, "situation"))).put("interval", interval((Interval) feat(pf, "interval")));
      case "PredicateFunctionAssignment": {
        JSONObject j = new JSONObject().put("t", "happensAssign").put("event", event((Event) feat(pf, "event")));
        return j.put("assignments", assignments(pf));
      }
      case "PredicateFunctionAssignmentOnly":
        return new JSONObject().put("t", "assign").put("assignments", assignments(pf));
      default:
        return new JSONObject().put("t", "unresolved").put("text", text(pf));
    }
  }

  @SuppressWarnings("unchecked")
  private JSONArray assignments(EObject pf) {
    JSONArray arr = new JSONArray();
    Object list = feat(pf, "assignment");
    if (list instanceof List<?> l) {
      for (Object o : l) {
        if (o instanceof OAssignExpression oa) {
          JSONObject a = new JSONObject();
          a.put("target", varRef(oa.getName2()));
          a.put("expr", expr(oa.getValue()));
          String t = text(oa.getName2());
          if (!t.isEmpty()) touch(t);
          arr.put(a);
        } else if (o instanceof OAssignment) {
          arr.put(new JSONObject().put("t", "unresolved").put("text", text((EObject) o)));
        }
      }
    }
    return arr;
  }

  private JSONObject event(Event e) {
    JSONObject j = new JSONObject();
    if (e == null) return j.put("k", "unresolved").put("text", "");
    if (e instanceof VariableEvent ve) {
      return eventVar(ve.getVariable(), j);
    }
    if (e instanceof DataTransfer dt) {
      eventVar(dt.getVariable(), j);
      j.put("dataTransferName", nz(dt.getName()));
      return j;
    }
    if (e instanceof ObligationEvent oe) {
      Obligation ob = oe.getObligationVariable();
      String n = ob == null || ob.eIsProxy() ? refText(oe) : nz(ob.getName());
      dep(n);
      return j.put("k", "obligation").put("state", nz(oe.getEventName())).put("norm", n)
          .put("normKind", normKind.getOrDefault(n, "obligation"));
    }
    if (e instanceof PowerEvent pe) {
      Power pw = pe.getPowerVariable();
      String n = pw == null || pw.eIsProxy() ? refText(pe) : nz(pw.getName());
      dep(n);
      return j.put("k", "power").put("state", nz(pe.getEventName())).put("norm", n).put("normKind", "power");
    }
    if (e instanceof ContractEvent ce) {
      return j.put("k", "contract").put("state", nz(ce.getEventName()));
    }
    return j.put("k", "unresolved").put("text", text(e));
  }

  /** Resolve a variable-based event: declared type, category, performer, controller. */
  private JSONObject eventVar(Ref r, JSONObject j) {
    j.put("k", "var");
    String ref = text(r);
    j.put("ref", ref);
    String root = rootVar(r);
    j.put("var", nz(root));
    if (!ref.isEmpty()) touch(ref);
    Variable v = root == null ? null : vars.get(root);
    if (v != null && v.getType() != null && !v.getType().eIsProxy()) {
      RegularType t = v.getType();
      j.put("type", nz(t.getName()));
      j.put("category", categoryOf(t));
      JSONObject init = initAssignments(v);
      if (init.has("performer")) j.put("performer", init.get("performer"));
      if (init.has("controller")) j.put("controller", init.get("controller"));
    } else {
      j.put("unresolved", true);
    }
    return j;
  }

  private JSONObject point(Point p) {
    if (p == null) return new JSONObject().put("k", "unresolved").put("text", "");
    return pointExpr(p.getPointExpression());
  }

  private JSONObject pointExpr(PointExpression pe) {
    JSONObject j = new JSONObject();
    if (pe == null) return j.put("k", "unresolved").put("text", "");
    if (pe instanceof PointFunction pf) {
      j.put("k", "add").put("arg", pointExpr(pf.getArg())).put("unit", nz(pf.getTimeUnit()));
      Timevalue tv = pf.getValue();
      if (tv instanceof TimevalueInt ti) j.put("value", ti.getValue());
      else if (tv instanceof TimevalueVariable tvv) j.put("value", varRef(tvv.getVariable()));
      return j;
    }
    if (pe instanceof PointAtomParameterDotExpression pa) {
      JSONObject v = varRef(pa.getVariable());
      v.put("k", "var");
      return v;
    }
    if (pe instanceof PointAtomObligationEvent po) return event(po.getObligationEvent()).put("k2", "event");
    if (pe instanceof PointAtomPowerEvent pp) return event(pp.getPowerEvent()).put("k2", "event");
    if (pe instanceof PointAtomContractEvent pc) return event(pc.getContractEvent()).put("k2", "event");
    return j.put("k", "unresolved").put("text", text(pe));
  }

  private JSONObject interval(Interval iv) {
    if (iv == null) return new JSONObject().put("k", "unresolved").put("text", "");
    IntervalExpression ie = iv.getIntervalExpression();
    if (ie instanceof IntervalFunction f)
      return new JSONObject().put("k", "interval").put("from", pointExpr(f.getArg1())).put("to", pointExpr(f.getArg2()));
    if (ie instanceof SituationExpression s) return situation(s.getSituation()).put("k", "situation");
    return new JSONObject().put("k", "unresolved").put("text", text(ie));
  }

  private JSONObject situation(Situation s) {
    JSONObject j = new JSONObject();
    if (s == null) return j.put("k", "unresolved").put("text", "");
    j.put("state", nz(s.getStateName()));
    if (s instanceof ObligationState os) {
      Obligation ob = os.getObligationVariable();
      String n = ob == null || ob.eIsProxy() ? refText(os) : nz(ob.getName());
      dep(n);
      return j.put("of", "obligation").put("norm", n).put("normKind", normKind.getOrDefault(n, "obligation"));
    }
    if (s instanceof PowerState ps) {
      Power pw = ps.getPowerVariable();
      String n = pw == null || pw.eIsProxy() ? refText(ps) : nz(pw.getName());
      dep(n);
      return j.put("of", "power").put("norm", n).put("normKind", "power");
    }
    if (s instanceof ContractState) return j.put("of", "contract");
    return j.put("k", "unresolved").put("text", text(s));
  }

  // ---------------------------------------------------------- expressions

  private JSONObject expr(Expression e) {
    if (e == null) return new JSONObject().put("t", "unresolved").put("text", "");
    String cls = e.eClass().getName();
    switch (cls) {
      case "Or": case "And": {
        JSONObject j = new JSONObject().put("t", cls.toLowerCase());
        JSONArray items = new JSONArray();
        items.put(expr((Expression) feat(e, "left")));
        items.put(expr((Expression) feat(e, "right")));
        return j.put("items", items);
      }
      case "Equality": case "Comparison":
        return new JSONObject().put("t", "cmp").put("op", nz((String) feat(e, "op")))
            .put("left", expr((Expression) feat(e, "left"))).put("right", expr((Expression) feat(e, "right")));
      case "Plus": case "Minus": case "Multi": case "Div": case "Mod": {
        String op = switch (cls) { case "Plus" -> "+"; case "Minus" -> "-"; case "Multi" -> "*"; case "Div" -> "/"; default -> "%"; };
        return new JSONObject().put("t", "arith").put("op", op)
            .put("left", expr((Expression) feat(e, "left"))).put("right", expr((Expression) feat(e, "right")));
      }
      case "PrimaryExpressionRecursive": return expr((Expression) feat(e, "inner"));
      case "NegatedPrimaryExpression": return new JSONObject().put("t", "not").put("p", expr((Expression) feat(e, "expression")));
      case "PrimaryExpressionFunctionCall": {
        EObject f = (EObject) feat(e, "function");
        JSONObject j = new JSONObject().put("t", "fn").put("name", f == null ? "" : nz((String) feat(f, "name")));
        JSONArray args = new JSONArray();
        if (f != null) for (String a : new String[] {"arg1", "arg2", "arg3", "value"}) {
          Object v = feat(f, a);
          if (v instanceof Expression ex) args.put(expr(ex));
        }
        Object unit = f == null ? null : feat(f, "timeUnit");
        if (unit != null) j.put("unit", String.valueOf(unit));
        return j.put("args", args);
      }
      case "AtomicExpressionTrue": return lit("bool", true);
      case "AtomicExpressionFalse": return lit("bool", false);
      case "AtomicExpressionDouble": case "AtomicExpressionInt": return lit("number", feat(e, "value"));
      case "AtomicExpressionString": return lit("string", feat(e, "value"));
      case "AtomicExpressionDate": return lit("date", String.valueOf(feat(e, "value")));
      case "AtomicExpressionEnum": {
        Enumeration en = (Enumeration) feat(e, "enumeration");
        EObject item = (EObject) feat(e, "enumItem");
        return new JSONObject().put("t", "enum").put("enum", en == null ? "" : nz(en.getName()))
            .put("item", item == null ? "" : nz(nameOf(item)));
      }
      case "AtomicExpressionParameter": return varRef((Ref) feat(e, "value"));
      default: return new JSONObject().put("t", "unresolved").put("text", text(e));
    }
  }

  private JSONObject lit(String kind, Object value) {
    return new JSONObject().put("t", "lit").put("kind", kind).put("value", value == null ? JSONObject.NULL : value);
  }

  /** {t:"var", ref:"delivered.reqID", var:"delivered", attrs:["reqID"], type, category, attrType?, env?} */
  private JSONObject varRef(Ref r) {
    JSONObject j = new JSONObject().put("t", "var");
    String ref = text(r);
    j.put("ref", ref);
    String root = rootVar(r);
    j.put("var", nz(root));
    JSONArray attrs = new JSONArray();
    Attribute last = null;
    for (Attribute a : attrChain(r)) { attrs.put(nz(a.getName())); last = a; }
    j.put("attrs", attrs);
    if (!ref.isEmpty() && current != null) touch(ref);
    Variable v = root == null ? null : vars.get(root);
    if (v != null && v.getType() != null && !v.getType().eIsProxy()) {
      j.put("type", nz(v.getType().getName()));
      j.put("category", categoryOf(v.getType()));
    } else if (root != null && params.containsKey(root)) {
      j.put("type", paramTypeName(params.get(root)));
      j.put("category", "Parameter");
    } else if (root != null) {
      j.put("unresolved", true);
    }
    if (last != null) {
      if (last.getBaseType() != null) j.put("attrType", nz(last.getBaseType().getName()));
      else if (last.getDomainType() != null && !last.getDomainType().eIsProxy()) j.put("attrType", nz(last.getDomainType().getName()));
      j.put("env", last.getAttributeModifier() != null);
    }
    return j;
  }

  // ------------------------------------------------------------- contract

  private JSONObject contract() {
    current = null;
    JSONObject c = new JSONObject();
    c.put("name", nz(model.getContractName()));
    c.put("domainName", nz(model.getDomainName()));
    c.put("timeUnit", model.getTimeUnits() == null ? JSONObject.NULL : model.getTimeUnits());

    JSONArray ps = new JSONArray();
    for (Parameter p : model.getParameters()) {
      JSONObject j = new JSONObject().put("name", nz(p.getName())).put("type", paramTypeName(p));
      String cat = "Value";
      if (p.getType() != null && p.getType().getDomainType() instanceof RegularType rt) cat = categoryOf(rt);
      j.put("category", cat);
      ps.put(j);
    }
    c.put("parameters", ps);

    // Declared variables, resolved: parties (roles), events, assets, data transfers.
    JSONArray parties = new JSONArray(), events = new JSONArray(), assets = new JSONArray(), sensors = new JSONArray(), others = new JSONArray();
    Set<String> referenced = new LinkedHashSet<>();
    for (Set<String> s : touches.values()) for (String t : s) referenced.add(t.contains(".") ? t.substring(0, t.indexOf('.')) : t);
    for (Rule r : model.getRules()) {
      String role = rootVar(r.getAccessedRole());
      if (role != null) referenced.add(role);
      String res = text(r.getAccessedResource());
      if (!res.isEmpty()) referenced.add(res.contains(".") ? res.substring(0, res.indexOf('.')) : res);
      String ctl = rootVar(r.getController());
      if (ctl != null) referenced.add(ctl);
    }
    for (Variable v : model.getVariables()) {
      JSONObject j = new JSONObject().put("var", nz(v.getName()));
      JSONObject pos = pos(v);
      j.put("line", pos.getInt("line")).put("col", pos.getInt("col"));
      RegularType t = v.getType();
      String cat = (t != null && !t.eIsProxy()) ? categoryOf(t) : "Other";
      j.put("type", t == null ? "" : nz(t.getName())).put("category", cat);
      j.put("init", initAssignments(v));
      j.put("referenced", referenced.contains(v.getName()));
      switch (cat) {
        case "Role" -> {
          j.put("thirdParty", isThirdParty(t, 0));
          String fp = fromParam(v);
          j.put("fromParam", fp == null ? JSONObject.NULL : fp);
          boolean isParty = false;
          for (Object o : normPartyVars()) if (v.getName().equals(o)) isParty = true;
          j.put("partyToNorm", isParty);
          parties.put(j);
        }
        case "Event" -> events.put(j);
        case "Asset" -> assets.put(j);
        case "DataTransfer" -> sensors.put(j);
        default -> others.put(j);
      }
    }
    c.put("parties", parties).put("events", events).put("assets", assets).put("sensors", sensors).put("others", others);

    c.put("preconditions", props(model.getPreconditions()));
    c.put("postconditions", props(model.getPostconditions()));
    c.put("constraints", props(model.getConstraints()));

    JSONArray acCtrl = new JSONArray();
    ACPolicy ac = model.getAcpolicys();
    if (ac != null) for (Controller ctl : ac.getController()) acCtrl.put(text(ctl.getControllerType()));
    c.put("acControllers", acCtrl);
    return c;
  }

  private JSONArray props(List<Proposition> list) {
    JSONArray arr = new JSONArray();
    for (Proposition p : list) arr.put(prop(p));
    return arr;
  }

  private Set<String> normPartyVars() {
    Set<String> s = new LinkedHashSet<>();
    for (Obligation o : model.getObligations()) { add(s, rootVar(o.getDebtor())); add(s, rootVar(o.getCreditor())); }
    for (Obligation o : model.getSurvivingObligations()) { add(s, rootVar(o.getDebtor())); add(s, rootVar(o.getCreditor())); }
    for (Power p : model.getPowers()) { add(s, rootVar(p.getDebtor())); add(s, rootVar(p.getCreditor())); }
    return s;
  }

  private static void add(Set<String> s, String v) { if (v != null) s.add(v); }

  /** attribute name -> expr JSON for a declaration's `with a := e, ...` list. */
  private JSONObject initAssignments(Variable v) {
    JSONObject j = new JSONObject();
    String saved = current;
    current = null; // declarations don't count as "touches" of a norm
    for (Assignment a : v.getAttributes()) {
      if (a instanceof AssignExpression ae && ae.getName() != null) j.put(ae.getName(), expr(ae.getValue()));
    }
    current = saved;
    return j;
  }

  // ----------------------------------------------------------- AC rules

  private List<String> rulesTouching(String norm, Set<String> touched) {
    List<String> out = new ArrayList<>();
    Set<String> roots = new LinkedHashSet<>();
    for (String t : touched) roots.add(t.contains(".") ? t.substring(0, t.indexOf('.')) : t);
    for (Rule r : model.getRules()) {
      EObject res = r.getAccessedResource();
      if (res == null) continue;
      String cls = res.eClass().getName();
      boolean hit = false;
      if (cls.equals("ResourceObligation") || cls.equals("ResourcePower")) {
        Object n = feat(res, cls.equals("ResourceObligation") ? "resourceOp" : "resourcePo");
        hit = n instanceof EObject eo && norm.equals(nameOf(eo));
      } else {
        String t = text(res);
        // Rule on a whole object ("vaccineDose") applies when the norm touches it or any
        // of its attributes; a rule on one attribute ("temperature.value") applies when the
        // norm touches that attribute or the whole object.
        String root = t.contains(".") ? t.substring(0, t.indexOf('.')) : t;
        hit = touched.contains(t) || (!t.contains(".") && roots.contains(t)) || (t.contains(".") && touched.contains(root));
      }
      if (hit) out.add(nz(r.getName()));
    }
    return out;
  }

  // ------------------------------------------------------------ comments

  /**
   * Comment lines immediately above a norm (joined), or null. Works on the
   * source text: consecutive lines directly above the norm's line that hold
   * only a "//" comment (or a block comment) are the specifier's note for it.
   * A blank line or a code line ends the run, so a trailing comment on the
   * previous norm's line is not mistaken for this norm's note.
   */
  private String authorNote(EObject e) {
    INode n = NodeModelUtils.getNode(e);
    if (n == null) return null;
    String[] lines = source.split("\r?\n", -1);
    int line = pos(e).getInt("line") - 1; // 0-based index of the norm's line
    List<String> notes = new ArrayList<>();
    for (int i = line - 1; i >= 0; i--) {
      String t = lines[i].trim();
      if (t.startsWith("//")) { notes.add(0, t.substring(2).trim()); continue; }
      if (t.endsWith("*/") && t.startsWith("/*")) {
        notes.add(0, t.substring(2, t.length() - 2).replaceAll("(?m)^\\s*\\*\\s?", "").trim());
        continue;
      }
      break;
    }
    String joined = String.join(" ", notes).replaceAll("\\s+", " ").trim();
    return joined.isEmpty() ? null : joined;
  }

  // ------------------------------------------------------------- helpers

  private void dep(String normName) {
    if (current == null || normName == null || normName.isEmpty() || normName.equals(current)) return;
    dependsOn.computeIfAbsent(current, k -> new LinkedHashSet<>()).add(normName);
  }

  private void touch(String ref) {
    if (current == null) return;
    touches.computeIfAbsent(current, k -> new LinkedHashSet<>()).add(ref);
  }

  private static Object feat(EObject o, String name) {
    if (o == null) return null;
    EStructuralFeature f = o.eClass().getEStructuralFeature(name);
    return f == null ? null : o.eGet(f);
  }

  private static String rootVar(Ref r) {
    while (r instanceof VariableDotExpression vde) r = vde.getRef();
    return r instanceof VariableRef vr ? vr.getVariable() : null;
  }

  private static List<Attribute> attrChain(Ref r) {
    List<Attribute> chain = new ArrayList<>();
    while (r instanceof VariableDotExpression vde) {
      if (vde.getTail() != null && !vde.getTail().eIsProxy()) chain.add(0, vde.getTail());
      r = vde.getRef();
    }
    return chain;
  }

  private static String rootVarOfExpr(Expression e) {
    if (e == null) return null;
    Object v = feat(e, "value");
    return v instanceof Ref r ? rootVar(r) : null;
  }

  private static String categoryOf(RegularType t) {
    return categoryOf(t, 0);
  }

  private static String categoryOf(RegularType t, int depth) {
    if (t == null || depth > 16) return "Other";
    OntologyType ot = t.getOntologyType();
    if (ot != null) return nz(ot.getName());
    if (t.getAResource() != null) return "Resource";
    RegularType p = t.getRegularType();
    if (p != null && !p.eIsProxy()) return categoryOf(p, depth + 1);
    return "Other";
  }

  private static boolean isThirdParty(RegularType t, int depth) {
    if (t == null || depth > 16) return false;
    if (t.getThirdParty() != null) return true;
    RegularType p = t.getRegularType();
    return p != null && !p.eIsProxy() && isThirdParty(p, depth + 1);
  }

  private static String paramTypeName(Parameter p) {
    if (p == null || p.getType() == null) return "";
    if (p.getType().getBaseType() != null) return nz(p.getType().getBaseType().getName());
    DomainType dt = p.getType().getDomainType();
    return dt == null || dt.eIsProxy() ? "" : nz(dt.getName());
  }

  private static String nameOf(EObject e) {
    Object n = feat(e, "name");
    return n instanceof String s ? s : "";
  }

  /** Source text of an unresolved cross-reference (e.g. the identifier after "obligations."). */
  private static String refText(EObject e) {
    String t = text(e);
    int i = t.lastIndexOf('.');
    int j = t.lastIndexOf(')');
    if (i >= 0) return t.substring(i + 1, j > i ? j : t.length()).trim();
    return t;
  }

  private static String text(EObject e) {
    if (e == null) return "";
    INode n = NodeModelUtils.getNode(e);
    return n == null ? "" : n.getText().trim().replaceAll("\\s+", " ");
  }

  private JSONObject pos(EObject e) {
    INode n = NodeModelUtils.getNode(e);
    int offset = n != null ? n.getOffset() : 0;
    int line = 1, col = 1;
    int max = Math.min(offset, source.length());
    for (int i = 0; i < max; i++) {
      if (source.charAt(i) == '\n') { line++; col = 1; } else { col++; }
    }
    return new JSONObject().put("line", line).put("col", col);
  }

  private static String nz(String s) { return s == null ? "" : s; }
}
