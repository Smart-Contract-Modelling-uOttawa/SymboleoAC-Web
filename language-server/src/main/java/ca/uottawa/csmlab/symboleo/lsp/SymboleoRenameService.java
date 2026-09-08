package ca.uottawa.csmlab.symboleo.lsp;

import com.google.inject.Inject;
import org.eclipse.emf.ecore.EObject;
import org.eclipse.lsp4j.PrepareRenameDefaultBehavior;
import org.eclipse.lsp4j.PrepareRenameParams;
import org.eclipse.lsp4j.PrepareRenameResult;
import org.eclipse.lsp4j.Range;
import org.eclipse.lsp4j.RenameParams;

import org.eclipse.lsp4j.TextEdit;
import org.eclipse.lsp4j.WorkspaceEdit;
import org.eclipse.lsp4j.jsonrpc.ResponseErrorException;
import org.eclipse.lsp4j.jsonrpc.messages.Either3;
import org.eclipse.lsp4j.jsonrpc.messages.ResponseError;
import org.eclipse.lsp4j.jsonrpc.messages.ResponseErrorCode;
import org.eclipse.xtext.GrammarUtil;
import org.eclipse.xtext.IGrammarAccess;
import org.eclipse.xtext.ide.server.Document;
import org.eclipse.xtext.ide.server.rename.RenameService2;
import org.eclipse.xtext.nodemodel.ILeafNode;
import org.eclipse.xtext.resource.XtextResource;
import org.eclipse.xtext.util.ITextRegion;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;

/**
 * Rename for SymboleoAC names that the grammar references by plain identifier
 * (variables, norms, rules, types, parameters, enumeration values). Renaming
 * replaces the declaration's name token and every identifier token with the
 * same text in the document (attribute names after "." are untouched, being a
 * different namespace). Real cross-references (attributes) fall through to the
 * default Xtext rename.
 */
public class SymboleoRenameService extends RenameService2 {

    @Inject
    private IGrammarAccess grammarAccess;

    @Override
    public Either3<Range, PrepareRenameResult, PrepareRenameDefaultBehavior> prepareRename(PrepareRenameOptions options) {
        PrepareRenameParams params = options.getParams();
        String uri = params.getTextDocument().getUri();
        Either3<Range, PrepareRenameResult, PrepareRenameDefaultBehavior> custom = options.getLanguageServerAccess().doSyncRead(uri, ctx -> {
            if (!(ctx.getResource() instanceof XtextResource res)) return null;
            Document doc = ctx.getDocument();
            ILeafNode leaf = SymboleoNames.identifierAt(res, doc.getOffSet(params.getPosition()));
            if (leaf == null || SymboleoNames.declarations(res, leaf.getText()).isEmpty()) return null;
            return Either3.<Range, PrepareRenameResult, PrepareRenameDefaultBehavior>forFirst(
                    new Range(doc.getPosition(leaf.getOffset()), doc.getPosition(leaf.getEndOffset())));
        });
        if (custom != null) return custom;
        try {
            return super.prepareRename(options);
        } catch (RuntimeException e) {
            return null; // nothing renameable here
        }
    }

    @Override
    public WorkspaceEdit rename(Options options) {
        RenameParams params = options.getRenameParams();
        String uri = params.getTextDocument().getUri();
        WorkspaceEdit custom = options.getLanguageServerAccess().doSyncRead(uri, ctx -> {
            if (!(ctx.getResource() instanceof XtextResource res)) return null;
            Document doc = ctx.getDocument();
            ILeafNode leaf = SymboleoNames.identifierAt(res, doc.getOffSet(params.getPosition()));
            if (leaf == null) return null;
            List<EObject> decls = SymboleoNames.declarations(res, leaf.getText());
            if (decls.isEmpty()) return null;
            String newName = params.getNewName();
            validate(newName, res);
            List<TextEdit> edits = new ArrayList<>();
            for (ILeafNode l : SymboleoNames.occurrences(res, leaf.getText())) {
                edits.add(new TextEdit(new Range(doc.getPosition(l.getOffset()), doc.getPosition(l.getEndOffset())), newName));
            }
            // Declaration name tokens are identifier tokens too, but include them explicitly
            // in case a declaration was not reached by the token scan.
            for (EObject d : decls) {
                ITextRegion r = SymboleoNames.nameRegion(d);
                Range range = new Range(doc.getPosition(r.getOffset()), doc.getPosition(r.getOffset() + r.getLength()));
                if (edits.stream().noneMatch(e -> e.getRange().equals(range))) edits.add(new TextEdit(range, newName));
            }
            WorkspaceEdit we = new WorkspaceEdit();
            we.setChanges(Collections.singletonMap(uri, edits));
            return we;
        });
        return custom != null ? custom : super.rename(options);
    }

    private void validate(String newName, XtextResource res) {
        if (newName == null || !newName.matches("[A-Za-z_]\\w*")) {
            throw invalid("'" + newName + "' is not a valid identifier");
        }
        Set<String> keywords = GrammarUtil.getAllKeywords(grammarAccess.getGrammar());
        if (keywords.contains(newName)) throw invalid("'" + newName + "' is a keyword");
        if (!SymboleoNames.declarations(res, newName).isEmpty()) throw invalid("'" + newName + "' is already declared");
    }

    private static ResponseErrorException invalid(String message) {
        return new ResponseErrorException(new ResponseError(ResponseErrorCode.InvalidParams, message, null));
    }
}
