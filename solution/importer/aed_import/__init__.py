from .http import Politeness, PoliteClient
from .importer import ImportRefused, RunSummary, SourceImporter
from .osm import OpenAEDMapSource, OverpassSource
from .records import Pull, SiteFields, Source, SourceRecord
from .warsaw import WarsawSource

SOURCES = {source.name: source for source in (OpenAEDMapSource, OverpassSource, WarsawSource)}

__all__ = ["SOURCES", "ImportRefused", "OpenAEDMapSource", "OverpassSource", "Politeness", "PoliteClient",
           "Pull", "RunSummary", "SiteFields", "Source", "SourceImporter", "SourceRecord", "WarsawSource"]
