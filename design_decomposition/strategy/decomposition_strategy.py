from abc import ABC, abstractmethod


class DecompositionStrategy(ABC):
    def __init__(self, client):
        super().__init__()
        self.client = client

    @abstractmethod
    def decompose(self, func_def, n=1, return_messages=False):
        pass
