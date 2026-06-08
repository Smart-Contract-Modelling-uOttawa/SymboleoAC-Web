package ca.uottawa.csmlab.symboleo.codegen;

import ca.uottawa.csmlab.symboleo.SymboleoStandaloneSetup;
import ca.uottawa.csmlab.symboleo.generator.Symboleo2SC;
import ca.uottawa.csmlab.symboleo.symboleo.Model;
import ca.uottawa.csmlab.symboleo.symboleo.SymboleoPackage;
import ca.uottawa.csmlab.symboleo.validation.SymboleoValidator;
import com.google.inject.Injector;
import com.google.inject.Key;
import com.google.inject.Provider;
import com.google.inject.TypeLiteral;
import org.eclipse.emf.common.util.URI;
import org.eclipse.emf.ecore.EObject;
import org.eclipse.emf.ecore.resource.Resource;
import org.eclipse.emf.ecore.resource.ResourceSet;
import org.eclipse.xtext.diagnostics.Severity;
import org.eclipse.xtext.generator.InMemoryFileSystemAccess;
import org.eclipse.xtext.util.CancelIndicator;
import org.eclipse.xtext.validation.CheckMode;
import org.eclipse.xtext.validation.EValidatorRegistrar;
import org.eclipse.xtext.validation.IResourceValidator;
import org.eclipse.xtext.validation.Issue;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Headless JavaScript code generator for SymboleoAC.
 *
 * Usage:
 *   java -jar symboleoac-codegen-cli-1.0.0-all.jar [--in &lt;file&gt;] [--name &lt;virtual-name&gt;]
 *
 * Source is read from --in &lt;path&gt; or stdin. --name sets the virtual filename
 * (default "input.symboleo") used by Xtext for URI / file extension routing.
 *
 * Output: a single JSON object on stdout:
 *   { "files": { "&lt;Contract&gt;/&lt;path&gt;": "&lt;content&gt;", ... },
 *     "issues": [ {severity,line,column,message,code}, ... ],
 *     "summary": {errors,warnings,generatedFiles} }
 *
 * Exit codes:
 *   0 - generated successfully (possibly with WARNING issues)
 *   1 - validation errors prevented codegen (issues still emitted; "files" empty)
 *   2 - usage / I/O failure
 */
public final class Codegen {

    public static void main(String[] args) {
        try {
            System.exit(run(args));
        } catch (Throwable t) {
            // Keep stdout clean so the bridge can parse JSON unconditionally.
            t.printStackTrace(System.err);
            System.exit(2);
        }
    }

    private static int run(String[] args) throws Exception {
        Path inPath = null;
        String virtualName = "input.symboleo";

        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--in":
                case "-i":
                    inPath = Paths.get(args[++i]);
                    break;
                case "--name":
                case "-n":
                    virtualName = args[++i];
                    break;
                case "--help":
                case "-h":
                    printUsage(System.out);
                    return 0;
                default:
                    System.err.println("Unknown argument: " + args[i]);
                    printUsage(System.err);
                    return 2;
            }
        }

        byte[] sourceBytes;
        if (inPath != null) {
            if (!Files.isRegularFile(inPath)) {
                System.err.println("Input file not found: " + inPath.toAbsolutePath());
                return 2;
            }
            sourceBytes = Files.readAllBytes(inPath);
        } else {
            sourceBytes = System.in.readAllBytes();
        }
        if (sourceBytes.length == 0) {
            System.err.println("Empty input (no bytes read from "
                    + (inPath != null ? inPath : "stdin") + ")");
            return 2;
        }
        // Strip UTF-8 BOM. The stream-based EMF loader does NOT strip it
        // (URI-based loaders do), and the upstream samples ship with a BOM
        // — leaving it produces a spurious "extraneous input '?'" parse error.
        if (sourceBytes.length >= 3
                && (sourceBytes[0] & 0xFF) == 0xEF
                && (sourceBytes[1] & 0xFF) == 0xBB
                && (sourceBytes[2] & 0xFF) == 0xBF) {
            byte[] stripped = new byte[sourceBytes.length - 3];
            System.arraycopy(sourceBytes, 3, stripped, 0, stripped.length);
            sourceBytes = stripped;
        }

        // The upstream Symboleo2SC generator prints debug noise to System.out
        // (e.g. "assign element=ca.uottawa...OAssignExpressionImpl@...") whenever
        // a contract uses Assign/OAssignment predicates (VaccineProcurement does;
        // MeatSale doesn't). That would corrupt the JSON we emit on stdout, so we
        // divert stdout to stderr for the whole run and restore it only to write
        // the final JSON. (stderr is surfaced in the bridge logs for debugging.)
        PrintStream realOut = System.out;
        System.setOut(System.err);

        Injector injector = new SymboleoStandaloneSetup().createInjectorAndDoEMFRegistration();
        // Same plugin.xml-vs-headless validator workaround as cli/Cli.java.
        SymboleoValidator validator = injector.getInstance(SymboleoValidator.class);
        EValidatorRegistrar registrar = injector.getInstance(EValidatorRegistrar.class);
        registrar.register(SymboleoPackage.eINSTANCE, validator);

        @SuppressWarnings("unchecked")
        Provider<ResourceSet> rsProvider = injector.getInstance(
                Key.get(new TypeLiteral<Provider<ResourceSet>>() {}));
        ResourceSet rs = rsProvider.get();

        // Use a synthetic URI so the .symboleo extension routes to our language.
        URI uri = URI.createURI("synthetic:/" + virtualName);
        Resource resource = rs.createResource(uri);
        try (InputStream in = new ByteArrayInputStream(sourceBytes)) {
            resource.load(in, Collections.emptyMap());
        }

        IResourceValidator resourceValidator = injector.getInstance(IResourceValidator.class);
        List<Issue> issues = resourceValidator.validate(
                resource, CheckMode.ALL, CancelIndicator.NullImpl);
        boolean hasErrors = issues.stream().anyMatch(i -> i.getSeverity() == Severity.ERROR);

        Map<String, CharSequence> files = Collections.emptyMap();
        if (!hasErrors && !resource.getContents().isEmpty()) {
            InMemoryFileSystemAccess fsa = new InMemoryFileSystemAccess();
            Symboleo2SC generator = new Symboleo2SC();
            for (EObject root : resource.getContents()) {
                if (root instanceof Model) {
                    generator.generateHFSource(fsa, (Model) root);
                }
            }
            // TreeMap → deterministic key order for diffable output.
            files = new TreeMap<>(fsa.getTextFiles());
        }

        System.setOut(realOut);
        writeOutput(realOut, files, issues);
        return hasErrors ? 1 : 0;
    }

    private static void writeOutput(PrintStream out,
                                    Map<String, CharSequence> files,
                                    List<Issue> issues) {
        JSONObject root = new JSONObject();
        JSONObject filesObj = new JSONObject();
        for (Map.Entry<String, CharSequence> e : files.entrySet()) {
            // InMemoryFileSystemAccess keys are like "DEFAULT_OUTPUT/path/to/file.js".
            // Strip the leading slot name so consumers see clean paths.
            String key = stripOutputSlot(e.getKey());
            filesObj.put(key, e.getValue().toString());
        }
        root.put("files", filesObj);

        JSONArray issuesArr = new JSONArray();
        long errors = 0, warnings = 0;
        for (Issue i : issues) {
            JSONObject o = new JSONObject();
            o.put("severity", String.valueOf(i.getSeverity()));
            o.put("line", i.getLineNumber() == null ? JSONObject.NULL : i.getLineNumber());
            o.put("column", i.getColumn() == null ? JSONObject.NULL : i.getColumn());
            o.put("offset", i.getOffset() == null ? JSONObject.NULL : i.getOffset());
            o.put("length", i.getLength() == null ? JSONObject.NULL : i.getLength());
            o.put("message", String.valueOf(i.getMessage()));
            o.put("code", i.getCode() == null ? JSONObject.NULL : i.getCode());
            issuesArr.put(o);
            if (i.getSeverity() == Severity.ERROR) errors++;
            else if (i.getSeverity() == Severity.WARNING) warnings++;
        }
        root.put("issues", issuesArr);

        root.put("summary", new JSONObject()
                .put("errors", errors)
                .put("warnings", warnings)
                .put("generatedFiles", files.size()));

        out.print(root.toString());
        out.flush();
    }

    private static String stripOutputSlot(String key) {
        // InMemoryFileSystemAccess keys look like "DEFAULT_OUTPUT./Foo/index.js"
        // (output-config name concatenated with the path passed to generateFile).
        // Strip the slot prefix and the leading "./" so callers see "Foo/index.js".
        String stripped = key;
        int dot = stripped.indexOf("./");
        if (dot >= 0) stripped = stripped.substring(dot + 2);
        return stripped;
    }

    private static void printUsage(PrintStream s) {
        s.println("Usage: symboleoac-codegen [--in <file>] [--name <virtual-name>]");
        s.println("Reads a .symboleo source from --in or stdin; writes generated JS as");
        s.println("a JSON object {files,issues,summary} to stdout.");
    }

    private Codegen() {}
}
