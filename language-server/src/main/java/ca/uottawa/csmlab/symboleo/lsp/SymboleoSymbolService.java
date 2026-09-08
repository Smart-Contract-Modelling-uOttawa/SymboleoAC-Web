package ca.uottawa.csmlab.symboleo.lsp;

import com.google.inject.Inject;
import org.eclipse.emf.ecore.EObject;
import org.eclipse.lsp4j.Location;
import org.eclipse.xtext.findReferences.IReferenceFinder;
import org.eclipse.xtext.ide.server.DocumentExtensions;
import org.eclipse.xtext.ide.server.symbol.DocumentSymbolService;
import org.eclipse.xtext.nodemodel.ILeafNode;
import org.eclipse.xtext.resource.IResourceDescriptions;
import org.eclipse.xtext.resource.XtextResource;
import org.eclipse.xtext.util.CancelIndicator;
import org.eclipse.xtext.util.TextRegion;

import java.util.ArrayList;
import java.util.List;

/**
 * Go-to-definition / find-references for SymboleoAC.
 *
 * The upstream grammar refers to declared names with plain identifiers rather
 * than Xtext cross-references, so the default {@link DocumentSymbolService}
 * finds nothing at a reference such as {@code seller} in
 * {@code Obligation(seller, ...)}. When the default service returns nothing,
 * the identifier under the cursor is looked up by name among the document's
 * declarations (see {@link SymboleoNames}). Attribute names after "." and the
 * {@code obligations.X} forms are real cross-references and stay with Xtext.
 */
public class SymboleoSymbolService extends DocumentSymbolService {

    @Inject
    private DocumentExtensions documentExtensions;

    @Override
    public List<? extends Location> getDefinitions(XtextResource resource, int offset,
            IReferenceFinder.IResourceAccess resourceAccess, CancelIndicator cancelIndicator) {
        List<? extends Location> fromXtext = super.getDefinitions(resource, offset, resourceAccess, cancelIndicator);
        if (!fromXtext.isEmpty()) return fromXtext;
        ILeafNode leaf = SymboleoNames.identifierAt(resource, offset);
        if (leaf == null) return fromXtext;
        List<Location> out = new ArrayList<>();
        for (EObject decl : SymboleoNames.declarations(resource, leaf.getText())) {
            out.add(documentExtensions.newLocation(resource, SymboleoNames.nameRegion(decl)));
        }
        return out;
    }

    @Override
    public List<? extends Location> getReferences(XtextResource resource, int offset,
            IReferenceFinder.IResourceAccess resourceAccess, IResourceDescriptions indexData,
            CancelIndicator cancelIndicator) {
        List<? extends Location> fromXtext = super.getReferences(resource, offset, resourceAccess, indexData, cancelIndicator);
        if (!fromXtext.isEmpty()) return fromXtext;
        ILeafNode leaf = SymboleoNames.identifierAt(resource, offset);
        if (leaf == null || SymboleoNames.declarations(resource, leaf.getText()).isEmpty()) return fromXtext;
        List<Location> out = new ArrayList<>();
        for (ILeafNode l : SymboleoNames.occurrences(resource, leaf.getText())) {
            out.add(documentExtensions.newLocation(resource, new TextRegion(l.getOffset(), l.getLength())));
        }
        return out;
    }
}
