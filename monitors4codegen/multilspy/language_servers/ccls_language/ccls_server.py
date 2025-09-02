import asyncio
import json
import logging
import os
import pathlib
import stat
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

from monitors4codegen.multilspy.multilspy_logger import MultilspyLogger
from monitors4codegen.multilspy.language_server import LanguageServer
from monitors4codegen.multilspy.lsp_protocol_handler.server import ProcessLaunchInfo
from monitors4codegen.multilspy.lsp_protocol_handler.lsp_types import InitializeParams
from monitors4codegen.multilspy.multilspy_config import MultilspyConfig
from monitors4codegen.multilspy.multilspy_utils import FileUtils
from monitors4codegen.multilspy.multilspy_utils import PlatformUtils


class CclsServer(LanguageServer):
    def __init__(
        self,
        config: MultilspyConfig,
        logger: MultilspyLogger,
        repository_root_path: str,
    ):
        """
        Creates a CclsServer instance. This class is not meant to be instantiated directly. Use LanguageServer.create() instead.
        """
        ccls_executable_path = self.setup_runtime_dependencies(logger, config)
        super().__init__(
            config,
            logger,
            repository_root_path,
            ProcessLaunchInfo(cmd=ccls_executable_path, cwd=repository_root_path),
            'c',
        )
        self.server_ready = asyncio.Event()

    @staticmethod
    def _find_executable(name: str) -> Optional[str]:
        """Find an executable in the system PATH."""
        path = os.getenv('PATH', '').split(os.pathsep)
        for directory in path:
            executable = os.path.join(directory, name)
            if os.path.isfile(executable) and os.access(executable, os.X_OK):
                return executable
        return None

    def setup_runtime_dependencies(
        self, logger: MultilspyLogger, config: MultilspyConfig
    ) -> str:
        platform_id = PlatformUtils.get_platform_id()

        with open(
            os.path.join(os.path.dirname(__file__), 'runtime_dependencies.json'), 'r'
        ) as f:
            d = json.load(f)
            del d['_description']

        assert platform_id.value in [
            'linux-x64',
        ], 'Only linux-x64 platform is supported for in multilspy at the moment'

        # TODO: Somehow install a version of ccls instead of assuming it is installed

        ccls_executable_path = self._find_executable('ccls')
        if not ccls_executable_path:
            raise RuntimeError(
                'ccls executable not found in PATH. Please ensure ccls is installed and available in your PATH.'
            )

        return ccls_executable_path

    def _get_initialize_params(self, repository_absolute_path: str) -> InitializeParams:
        with open(
            os.path.join(os.path.dirname(__file__), 'initialize_params.json'), 'r'
        ) as f:
            d = json.load(f)

        del d['_description']

        d['processId'] = os.getpid()
        assert d['rootPath'] == '$rootPath'
        d['rootPath'] = repository_absolute_path

        assert d['rootUri'] == '$rootUri'
        d['rootUri'] = pathlib.Path(repository_absolute_path).as_uri()

        assert d['workspaceFolders'][0]['uri'] == '$uri'
        d['workspaceFolders'][0]['uri'] = pathlib.Path(
            repository_absolute_path
        ).as_uri()

        assert d['workspaceFolders'][0]['name'] == '$name'
        d['workspaceFolders'][0]['name'] = os.path.basename(repository_absolute_path)

        return d

    @asynccontextmanager
    async def start_server(self) -> AsyncIterator['CclsServer']:
        """
        Starts the Ccls Language Server, waits for the server to be ready and yields the LanguageServer instance.

        Usage:
        ```
        async with lsp.start_server():
            # LanguageServer has been initialized and ready to serve requests
            await lsp.request_definition(...)
            await lsp.request_references(...)
            # Shutdown the LanguageServer on exit from scope
        # LanguageServer has been shutdown
        ```
        """

        async def register_capability_handler(params):
            assert 'registrations' in params
            for registration in params['registrations']:
                if registration['method'] == 'workspace/executeCommand':
                    self.initialize_searcher_command_available.set()
                    self.resolve_main_method_available.set()
            return

        async def lang_status_handler(params):
            if params['type'] == 'ServiceReady' and params['message'] == 'ServiceReady':
                self.service_ready_event.set()

        async def execute_client_command_handler(params):
            return []

        async def do_nothing(params):
            return

        async def check_experimental_status(params):
            if params['quiescent'] == True:
                self.server_ready.set()

        async def window_log_message(msg):
            self.logger.log(f'LSP: window/logMessage: {msg}', logging.INFO)

        self.server.on_request('client/registerCapability', register_capability_handler)
        self.server.on_notification('language/status', lang_status_handler)
        self.server.on_notification('window/logMessage', window_log_message)
        self.server.on_request(
            'workspace/executeClientCommand', execute_client_command_handler
        )
        self.server.on_notification('$/progress', do_nothing)
        self.server.on_notification('textDocument/publishDiagnostics', do_nothing)
        self.server.on_notification('language/actionableNotification', do_nothing)
        self.server.on_notification(
            'experimental/serverStatus', check_experimental_status
        )

        async with super().start_server():
            self.logger.log(
                'Starting ccls-language-server server process', logging.INFO
            )
            await self.server.start()
            initialize_params = self._get_initialize_params(self.repository_root_path)

            self.logger.log(
                'Sending initialize request from LSP client to LSP server and awaiting response',
                logging.INFO,
            )
            init_response = await self.server.send.initialize(initialize_params)
            assert init_response['capabilities']['textDocumentSync']['change'] == 2
            assert 'completionProvider' in init_response['capabilities']
            """
            assert init_response["capabilities"]["completionProvider"] == {
                "triggerCharacters": [":", ".", "'", "("],
                "resolveProvider": True,
            }
            """

            self.server.notify.initialized({})
            """
            self.completions_available.set()

            await self.server_ready.wait()
            """

            yield self

            await self.server.shutdown()
            await self.server.stop()
