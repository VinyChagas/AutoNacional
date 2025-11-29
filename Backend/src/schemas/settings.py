"""
Schemas Pydantic para configurações de automação.
"""

from typing import Optional
from pydantic import BaseModel, Field, field_validator


class AutomationSettingsBase(BaseModel):
    """Schema base para configurações de automação."""
    
    # Execução Geral
    headless: bool = Field(default=False, description="Executar navegador em modo headless")
    company_timeout_seconds: int = Field(default=300, ge=0, description="Timeout por empresa em segundos")
    max_retries_per_step: int = Field(default=3, ge=0, description="Máximo de tentativas por etapa")
    min_action_delay_ms: int = Field(default=500, ge=0, description="Delay mínimo entre ações em milissegundos")
    
    # Navegadores / Concorrência
    max_concurrent_browsers: int = Field(default=5, ge=1, description="Máximo de navegadores concorrentes")
    default_concurrent_browsers: int = Field(default=3, ge=1, description="Navegadores concorrentes padrão")
    browser_launch_delay_ms: int = Field(default=1000, ge=0, description="Delay entre lançamentos de navegador em ms")
    viewport_preset: str = Field(default="FULLHD", description="Preset de viewport: HD, FULLHD, QHD, CUSTOM")
    viewport_width: Optional[int] = Field(default=None, ge=1, description="Largura do viewport (apenas se CUSTOM)")
    viewport_height: Optional[int] = Field(default=None, ge=1, description="Altura do viewport (apenas se CUSTOM)")
    
    # Diretórios
    downloads_base_path: str = Field(default="./downloads", description="Caminho base para downloads")
    downloads_pattern: str = Field(default="{cnpj}/{ano}/{mes}", description="Padrão de organização de downloads")
    logs_path: str = Field(default="./logs", description="Caminho para arquivos de log")
    temp_path: str = Field(default="./temp", description="Caminho para arquivos temporários")
    
    # Logs & Relatórios
    log_level: str = Field(default="INFO", description="Nível de log: ERROR, WARN, INFO, DEBUG")
    save_error_screenshots: bool = Field(default=True, description="Salvar screenshots de erros")
    generate_pdf_report: bool = Field(default=True, description="Gerar relatório PDF")
    log_retention_days: int = Field(default=30, ge=0, description="Dias de retenção de logs")
    max_errors_in_panel: int = Field(default=100, ge=0, description="Máximo de erros exibidos no painel")
    
    @field_validator('viewport_preset')
    @classmethod
    def validate_viewport_preset(cls, v: str) -> str:
        """Valida o preset de viewport."""
        allowed = ['HD', 'FULLHD', 'QHD', 'CUSTOM']
        if v.upper() not in allowed:
            raise ValueError(f"viewport_preset deve ser um de: {', '.join(allowed)}")
        return v.upper()
    
    @field_validator('log_level')
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Valida o nível de log."""
        allowed = ['ERROR', 'WARN', 'INFO', 'DEBUG']
        if v.upper() not in allowed:
            raise ValueError(f"log_level deve ser um de: {', '.join(allowed)}")
        return v.upper()
    
    @field_validator('viewport_width', 'viewport_height')
    @classmethod
    def validate_viewport_custom(cls, v: Optional[int], info) -> Optional[int]:
        """Valida viewport custom se preset for CUSTOM."""
        # Esta validação será feita no modelo completo
        return v


class AutomationSettingsCreate(AutomationSettingsBase):
    """Schema para criação de configurações."""
    pass


class AutomationSettingsUpdate(AutomationSettingsBase):
    """Schema para atualização de configurações."""
    pass


class AutomationSettingsResponse(AutomationSettingsBase):
    """Schema de resposta para configurações."""
    
    id: int = Field(description="ID da configuração (sempre 1)")
    
    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": 1,
                "headless": False,
                "company_timeout_seconds": 300,
                "max_retries_per_step": 3,
                "min_action_delay_ms": 500,
                "max_concurrent_browsers": 5,
                "default_concurrent_browsers": 3,
                "browser_launch_delay_ms": 1000,
                "viewport_preset": "FULLHD",
                "viewport_width": None,
                "viewport_height": None,
                "downloads_base_path": "./downloads",
                "downloads_pattern": "{cnpj}/{ano}/{mes}",
                "logs_path": "./logs",
                "temp_path": "./temp",
                "log_level": "INFO",
                "save_error_screenshots": True,
                "generate_pdf_report": True,
                "log_retention_days": 30,
                "max_errors_in_panel": 100
            }
        }

