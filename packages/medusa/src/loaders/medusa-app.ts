import {
  MedusaApp,
  MedusaAppMigrateDown,
  MedusaAppMigrateUp,
  MedusaAppOutput,
  ModulesDefinition,
} from "@medusajs/modules-sdk"
import {
  CommonTypes,
  ConfigModule,
  InternalModuleDeclaration,
  LoadedModule,
  MedusaContainer,
  ModuleDefinition,
} from "@medusajs/types"
import {
  ContainerRegistrationKeys,
  isObject,
  upperCaseFirst,
} from "@medusajs/utils"

import { asValue } from "awilix"
import { remoteQueryFetchData } from "../utils/remote-query-fetch-data"

export function mergeDefaultModules(
  modulesConfig: CommonTypes.ConfigModule["modules"]
) {
  const defaultModules = Object.values(ModulesDefinition).filter(
    (definition: ModuleDefinition) => {
      return !!definition.defaultPackage
    }
  )

  const configModules = { ...modulesConfig } ?? {}

  for (const defaultModule of defaultModules as ModuleDefinition[]) {
    configModules[defaultModule.key] ??= defaultModule.defaultModuleDeclaration
  }

  for (const [key, value] of Object.entries(
    configModules as Record<string, InternalModuleDeclaration>
  )) {
    const def = {} as ModuleDefinition
    def.key ??= key
    def.registrationName ??= key
    def.label ??= upperCaseFirst(key)

    const orignalDef = value?.definition
    if (isObject(orignalDef)) {
      value.definition = {
        ...orignalDef,
        ...def,
      }
    }
  }

  return configModules
}

async function runMedusaAppMigrations({
  configModule,
  container,
  revert = false,
}: {
  configModule: {
    modules?: CommonTypes.ConfigModule["modules"]
    projectConfig: CommonTypes.ConfigModule["projectConfig"]
  }
  container: MedusaContainer
  revert?: boolean
}): Promise<void> {
  const injectedDependencies = {
    [ContainerRegistrationKeys.PG_CONNECTION]: container.resolve(
      ContainerRegistrationKeys.PG_CONNECTION
    ),
    [ContainerRegistrationKeys.LOGGER]: container.resolve(
      ContainerRegistrationKeys.LOGGER
    ),
  }

  const sharedResourcesConfig = {
    database: {
      clientUrl:
        injectedDependencies[ContainerRegistrationKeys.PG_CONNECTION]?.client
          ?.config?.connection?.connectionString ??
        configModule.projectConfig.database_url,
      driverOptions: configModule.projectConfig.database_driver_options,
      debug: !!(configModule.projectConfig.database_logging ?? false),
    },
  }
  const configModules = mergeDefaultModules(configModule.modules)

  if (revert) {
    await MedusaAppMigrateDown({
      modulesConfig: configModules,
      remoteFetchData: remoteQueryFetchData(container),
      sharedContainer: container,
      sharedResourcesConfig,
      injectedDependencies,
    })
  } else {
    await MedusaAppMigrateUp({
      modulesConfig: configModules,
      remoteFetchData: remoteQueryFetchData(container),
      sharedContainer: container,
      sharedResourcesConfig,
      injectedDependencies,
    })
  }
}

export async function migrateMedusaApp({
  configModule,
  container,
}: {
  configModule: {
    modules?: CommonTypes.ConfigModule["modules"]
    projectConfig: CommonTypes.ConfigModule["projectConfig"]
  }
  container: MedusaContainer
}): Promise<void> {
  await runMedusaAppMigrations({
    configModule,
    container,
  })
}

export async function revertMedusaApp({
  configModule,
  container,
}: {
  configModule: {
    modules?: CommonTypes.ConfigModule["modules"]
    projectConfig: CommonTypes.ConfigModule["projectConfig"]
  }
  container: MedusaContainer
}): Promise<void> {
  await runMedusaAppMigrations({
    configModule,
    container,
    revert: true,
  })
}

export const loadMedusaApp = async (
  {
    container,
  }: {
    container: MedusaContainer
  },
  config = { registerInContainer: true }
): Promise<MedusaAppOutput> => {
  const injectedDependencies = {
    [ContainerRegistrationKeys.PG_CONNECTION]: container.resolve(
      ContainerRegistrationKeys.PG_CONNECTION
    ),
    [ContainerRegistrationKeys.LOGGER]: container.resolve(
      ContainerRegistrationKeys.LOGGER
    ),
  }

  const configModule: ConfigModule = container.resolve(
    ContainerRegistrationKeys.CONFIG_MODULE
  )

  const sharedResourcesConfig = {
    database: {
      clientUrl: configModule.projectConfig.database_url,
      driverOptions: configModule.projectConfig.database_driver_options,
      debug: !!(configModule.projectConfig.database_logging ?? false),
    },
  }

  container.register(ContainerRegistrationKeys.REMOTE_QUERY, asValue(undefined))
  container.register(ContainerRegistrationKeys.REMOTE_LINK, asValue(undefined))

  const configModules = mergeDefaultModules(configModule.modules)

  const medusaApp = await MedusaApp({
    workerMode: configModule.projectConfig.worker_mode,
    modulesConfig: configModules,
    remoteFetchData: remoteQueryFetchData(container),
    sharedContainer: container,
    sharedResourcesConfig,
    injectedDependencies,
  })

  if (!config.registerInContainer) {
    return medusaApp
  }

  container.register(
    ContainerRegistrationKeys.REMOTE_LINK,
    asValue(medusaApp.link)
  )
  container.register(
    ContainerRegistrationKeys.REMOTE_QUERY,
    asValue(medusaApp.query)
  )

  for (const moduleService of Object.values(medusaApp.modules)) {
    const loadedModule = moduleService as LoadedModule
    container.register(
      loadedModule.__definition.registrationName,
      asValue(moduleService)
    )
  }

  // Register all unresolved modules as undefined to be present in the container with undefined value by defaul
  // but still resolvable
  for (const moduleDefinition of Object.values(ModulesDefinition)) {
    if (!container.hasRegistration(moduleDefinition.registrationName)) {
      container.register(moduleDefinition.registrationName, asValue(undefined))
    }
  }

  return medusaApp
}

/**
 * Run the modules loader without taking care of anything else. This is useful for running the loader as a separate action or to re run all modules loaders.
 *
 * @param configModule
 * @param container
 */
export async function runModulesLoader({
  configModule,
  container,
}: {
  configModule: {
    modules?: CommonTypes.ConfigModule["modules"]
    projectConfig: CommonTypes.ConfigModule["projectConfig"]
  }
  container: MedusaContainer
}): Promise<void> {
  const injectedDependencies = {
    [ContainerRegistrationKeys.PG_CONNECTION]: container.resolve(
      ContainerRegistrationKeys.PG_CONNECTION
    ),
    [ContainerRegistrationKeys.LOGGER]: container.resolve(
      ContainerRegistrationKeys.LOGGER
    ),
  }

  const sharedResourcesConfig = {
    database: {
      clientUrl: configModule.projectConfig.database_url,
      driverOptions: configModule.projectConfig.database_driver_options,
      debug: !!(configModule.projectConfig.database_logging ?? false),
    },
  }

  const configModules = mergeDefaultModules(configModule.modules)

  await MedusaApp({
    modulesConfig: configModules,
    remoteFetchData: remoteQueryFetchData(container),
    sharedContainer: container,
    sharedResourcesConfig,
    injectedDependencies,
    loaderOnly: true,
  })
}

export default loadMedusaApp
