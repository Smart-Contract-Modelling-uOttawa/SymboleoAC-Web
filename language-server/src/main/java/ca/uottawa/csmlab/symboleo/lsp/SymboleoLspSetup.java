package ca.uottawa.csmlab.symboleo.lsp;

import ca.uottawa.csmlab.symboleo.ide.SymboleoIdeSetup;
import ca.uottawa.csmlab.symboleo.symboleo.SymboleoPackage;
import ca.uottawa.csmlab.symboleo.validation.SymboleoValidator;
import com.google.inject.Injector;
import org.eclipse.xtext.validation.EValidatorRegistrar;

/**
 * ISetup discovered by {@code org.eclipse.xtext.ide.server.ServerLauncher} via
 * the ServiceLoader entry under META-INF/services/org.eclipse.xtext.ISetup.
 *
 * Subclasses the project's generated {@link SymboleoIdeSetup}, which mixes the
 * runtime module with the REAL {@code SymboleoIdeModule} (its
 * {@code AbstractSymboleoIdeModule} binds the generated content-assist ANTLR
 * parser). That is what gives grammar-driven completion — proposals were empty
 * under the earlier {@code DefaultIdeModule} fallback because no content-assist
 * parser was bound.
 *
 * We only add the headless validator re-registration on top: plugin.xml's
 * eValidator extension point doesn't run outside Eclipse, so @Check methods
 * would otherwise never fire (same workaround as Cli.java).
 */
public class SymboleoLspSetup extends SymboleoIdeSetup {

    @Override
    public Injector createInjectorAndDoEMFRegistration() {
        Injector injector = super.createInjectorAndDoEMFRegistration();
        EValidatorRegistrar registrar = injector.getInstance(EValidatorRegistrar.class);
        SymboleoValidator validator = injector.getInstance(SymboleoValidator.class);
        registrar.register(SymboleoPackage.eINSTANCE, validator);
        return injector;
    }
}
